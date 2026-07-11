// ============================================
// دوال حساب المؤشرات الفنية: RSI, MACD, Bollinger Bands, دعم/مقاومة
// ============================================

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  result.push(prev);
  for (let i = 1; i < values.length; i++) {
    const val = values[i] * k + prev * (1 - k);
    result.push(val);
    prev = val;
  }
  return result;
}

export function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function stddev(values: number[], period: number, meanSeries: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || Number.isNaN(meanSeries[i])) {
      result.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = meanSeries[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    result.push(Math.sqrt(variance));
  }
  return result;
}

export function rsi(values: number[], period = 14): number[] {
  const result: number[] = [NaN];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      result.push(i === period ? 100 - 100 / (1 + avgGain / (avgLoss || 1e-10)) : NaN);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgGain / (avgLoss || 1e-10);
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

export interface MacdResult {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
}

export function macd(values: number[], fastLen = 12, slowLen = 26, signalLen = 9): MacdResult {
  const emaFast = ema(values, fastLen);
  const emaSlow = ema(values, slowLen);
  const macdLine = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signalLen);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

export interface BollingerResult {
  upper: number[];
  mid: number[];
  lower: number[];
}

export function bollingerBands(values: number[], period = 20, stdDevMult = 2): BollingerResult {
  const mid = sma(values, period);
  const sd = stddev(values, period, mid);
  const upper = mid.map((m, i) => m + sd[i] * stdDevMult);
  const lower = mid.map((m, i) => m - sd[i] * stdDevMult);
  return { upper, mid, lower };
}

// دعم/مقاومة بسيطة: أعلى قمة وأدنى قاع خلال آخر lookback شمعة
export function findSupportResistance(highs: number[], lows: number[], lookback = 50) {
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  return {
    resistance: Math.max(...recentHighs),
    support: Math.min(...recentLows),
  };
}
