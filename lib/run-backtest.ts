import { supabase } from '@/lib/supabase';
import { runBacktest, Candle, BacktestParams } from '@/lib/backtest-engine';

const TWELVE_DATA_TOKEN = process.env.TWELVE_DATA_API_KEY!;

export interface RunBacktestInput {
  symbol: string;
  timeframe?: string;
  from?: string;
  to?: string;
  emaFastLen?: number;
  emaSlowLen?: number;
  volAvgLen?: number;
  volMult?: number;
}

// ============================================
// المنطق الكامل: جلب بيانات (كاش أو Twelve Data) + تشغيل الباك-تست + تخزين النتيجة
// يُستخدم من:
//  1) app/api/backtest/route.ts (استدعاء مباشر عن طريق POST خارجي)
//  2) app/api/fahd-chat/route.ts (استدعاء داخلي لما فهد يستخدم أداة run_backtest)
// ============================================

export async function executeBacktest(input: RunBacktestInput) {
  const symbol = (input.symbol || '').toUpperCase().trim();
  if (!symbol) {
    return { error: 'رمز السهم مطلوب' };
  }

  const intervalMap: Record<string, string> = {
    '1D': '1day',
    D: '1day',
    '1W': '1week',
    '1M': '1month',
    '1MIN': '1min',
    '5MIN': '5min',
    '15MIN': '15min',
    '30MIN': '30min',
    '1H': '1h',
    '4H': '4h',
  };
  const rawTimeframe = input.timeframe || '15min';
  const interval = intervalMap[rawTimeframe.toUpperCase()] || rawTimeframe;
  const isIntraday = !['1day', '1week', '1month'].includes(interval);

  const defaultLookbackDays = isIntraday ? 90 : 365;
  const toDate = input.to ? new Date(input.to) : new Date();
  const fromDate = input.from
    ? new Date(input.from)
    : new Date(toDate.getTime() - defaultLookbackDays * 24 * 60 * 60 * 1000);

  const { data: cached } = await supabase
    .from('historical_prices')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', interval)
    .gte('timestamp', fromDate.toISOString())
    .lte('timestamp', toDate.toISOString())
    .order('timestamp', { ascending: true });

  let candles: Candle[];
  const expectedMinRows = 30;

  if (!cached || cached.length < expectedMinRows) {
    const startDateStr = fromDate.toISOString().split('T')[0];
    const endDateStr = toDate.toISOString().split('T')[0];

    const tdUrl = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&start_date=${startDateStr}&end_date=${endDateStr}&outputsize=5000&apikey=${TWELVE_DATA_TOKEN}`;
    const tRes = await fetch(tdUrl);
    const tData = await tRes.json();

    if (tData.status === 'error' || !tData.values || tData.values.length === 0) {
      return {
        error: `ما فيه بيانات كافية للرمز ${symbol} بهالفترة`,
        details: tData.message || null,
      };
    }

    const values = [...tData.values].reverse();
    candles = values.map((v: any) => ({
      timestamp: new Date(v.datetime).toISOString(),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume, 10) || 0,
    }));

    const rowsToInsert = candles.map((c) => ({
      symbol,
      timeframe: interval,
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
    candles = cached.map((row: any) => ({
      timestamp: row.timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
  }

  const params: BacktestParams = {
    emaFastLen: input.emaFastLen,
    emaSlowLen: input.emaSlowLen,
    volAvgLen: input.volAvgLen,
    volMult: input.volMult,
  };
  const result = runBacktest(candles, params);

  await supabase.from('backtest_results').insert({
    strategy_name: 'EMA_9_21_VWAP_Volume',
    symbol,
    timeframe: interval,
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

  return {
    symbol,
    timeframe: interval,
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    result,
  };
}
