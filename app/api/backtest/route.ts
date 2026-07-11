import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runBacktest, Candle } from '@/lib/backtest-engine';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const TWELVE_DATA_TOKEN = process.env.TWELVE_DATA_API_KEY!;

// ============================================
// POST /api/backtest
// body: { symbol: string, from?: string (YYYY-MM-DD), to?: string, timeframe?: string }
// يشتغل لأي رمز سهم يُدخل - عام بالكامل
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = (body.symbol || '').toUpperCase().trim();
    const timeframe = body.timeframe || '1D'; // فريم يومي افتراضياً

    if (!symbol) {
      return NextResponse.json({ error: 'رمز السهم مطلوب' }, { status: 400 });
    }

    // نطاق زمني افتراضي: آخر سنة، أو حسب طلب المستخدم
    const toDate = body.to ? new Date(body.to) : new Date();
    const fromDate = body.from
      ? new Date(body.from)
      : new Date(toDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    // 1) تحقق هل البيانات موجودة مسبقاً بقاعدة البيانات (كاش)
    const { data: cached } = await supabase
      .from('historical_prices')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', fromDate.toISOString())
      .lte('timestamp', toDate.toISOString())
      .order('timestamp', { ascending: true });

    let candles: Candle[];

    // لو البيانات ناقصة أو غير موجودة، اجلبها من Twelve Data
    const expectedMinRows = 30; // حد أدنى تقريبي عشان نعتبرها "كافية"
    if (!cached || cached.length < expectedMinRows) {
      // Twelve Data يستخدم صيغة interval مختلفة عن Finnhub
      const intervalMap: Record<string, string> = {
        '1D': '1day',
        'D': '1day',
        '1W': '1week',
        '1M': '1month',
      };
      const interval = intervalMap[timeframe] || '1day';
      const startDateStr = fromDate.toISOString().split('T')[0];
      const endDateStr = toDate.toISOString().split('T')[0];

      const tdUrl = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&start_date=${startDateStr}&end_date=${endDateStr}&outputsize=5000&apikey=${TWELVE_DATA_TOKEN}`;
      const tRes = await fetch(tdUrl);
      const tData = await tRes.json();

      if (tData.status === 'error' || !tData.values || tData.values.length === 0) {
        return NextResponse.json(
          {
            error: `ما فيه بيانات كافية للرمز ${symbol} بهالفترة`,
            details: tData.message || null,
          },
          { status: 404 }
        );
      }

      // Twelve Data يرجع الأحدث أول، نعكس الترتيب عشان يكون زمنياً تصاعدي
      const values = [...tData.values].reverse();

      candles = values.map((v: any) => ({
        timestamp: new Date(v.datetime).toISOString(),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseInt(v.volume, 10) || 0,
      }));

      // خزّن بقاعدة البيانات للاستخدام القادم (upsert لتفادي التكرار)
      const rowsToInsert = candles.map((c) => ({
        symbol,
        timeframe,
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      await supabase
        .from('historical_prices')
        .upsert(rowsToInsert, { onConflict: 'symbol,timeframe,timestamp' });
    } else {
      candles = cached.map((row) => ({
        timestamp: row.timestamp,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      }));
    }

    // 2) شغّل الـ backtest
    const params = {
      emaFastLen: body.emaFastLen,
      emaSlowLen: body.emaSlowLen,
      volAvgLen: body.volAvgLen,
      volMult: body.volMult,
    };
    const result = runBacktest(candles, params);

    // 3) خزّن النتيجة
    await supabase.from('backtest_results').insert({
      strategy_name: 'EMA_9_21_VWAP_Volume',
      symbol,
      timeframe,
      start_date: fromDate.toISOString(),
      end_date: toDate.toISOString(),
      total_trades: result.totalTrades,
      winning_trades: result.winningTrades,
      losing_trades: result.losingTrades,
      win_rate: result.winRate,
      total_return_pct: result.totalReturnPct,
      max_drawdown_pct: result.maxDrawdownPct,
      params,
      trades_detail: result.trades,
    });

    return NextResponse.json({
      symbol,
      timeframe,
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
