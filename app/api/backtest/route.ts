import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runBacktest, Candle } from '@/lib/backtest-engine';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FINNHUB_TOKEN = process.env.FINNHUB_API_KEY!;

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

    // لو البيانات ناقصة أو غير موجودة، اجلبها من Finnhub
    const expectedMinRows = 30; // حد أدنى تقريبي عشان نعتبرها "كافية"
    if (!cached || cached.length < expectedMinRows) {
      const resolution = timeframe === '1D' ? 'D' : timeframe;
      const fromUnix = Math.floor(fromDate.getTime() / 1000);
      const toUnix = Math.floor(toDate.getTime() / 1000);

      const finnhubUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${fromUnix}&to=${toUnix}&token=${FINNHUB_TOKEN}`;
      const fRes = await fetch(finnhubUrl);
      const fData = await fRes.json();

      if (fData.s !== 'ok' || !fData.c || fData.c.length === 0) {
        return NextResponse.json(
          { error: `ما فيه بيانات كافية للرمز ${symbol} بهالفترة` },
          { status: 404 }
        );
      }

      candles = fData.t.map((ts: number, i: number) => ({
        timestamp: new Date(ts * 1000).toISOString(),
        open: fData.o[i],
        high: fData.h[i],
        low: fData.l[i],
        close: fData.c[i],
        volume: fData.v[i],
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
