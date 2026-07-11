// ============================================
// محرك اختبار الاستراتيجيات (Backtest Engine)
// استراتيجية: EMA 9/21 crossover + VWAP + تأكيد الحجم
// نفس منطق مؤشر Pine Script "فهد - EMA + VWAP + Volume"
// ============================================

export interface Candle {
  timestamp: string; // ISO date
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number;
  reason: string; // سبب الدخول أو الخروج
  autoClosedAtEnd?: boolean; // true لو الصفقة أُغلقت افتراضياً لانتهاء البيانات، مو بإشارة خروج حقيقية
}

export interface BacktestParams {
  emaFastLen?: number;
  emaSlowLen?: number;
  volAvgLen?: number;
  volMult?: number;
  costPct?: number; // عمولة + انزلاق سعري تقديري لكل جهة (دخول/خروج)، كنسبة مئوية. افتراضي 0.05%
}

export interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: Trade[];
}

function ema(values: number[], period: number): number[] {
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

// VWAP يومي: يُعاد ضبطه (reset) في بداية كل يوم تداول جديد
// هذا يطابق الاستخدام الصحيح لـ VWAP كمرجع "سعر اليوم" وليس تراكمي على كل الفترة
function vwapSeries(candles: Candle[]): number[] {
  let cumPV = 0;
  let cumVol = 0;
  let currentDay = '';

  return candles.map((c) => {
    const day = c.timestamp.split('T')[0]; // YYYY-MM-DD
    if (day !== currentDay) {
      // يوم تداول جديد: صفّر التراكم
      currentDay = day;
      cumPV = 0;
      cumVol = 0;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
    return cumVol === 0 ? typicalPrice : cumPV / cumVol;
  });
}

function sma(values: number[], period: number): number[] {
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

export function runBacktest(
  candles: Candle[],
  params: BacktestParams = {}
): BacktestResult {
  const emaFastLen = params.emaFastLen ?? 9;
  const emaSlowLen = params.emaSlowLen ?? 21;
  const volAvgLen = params.volAvgLen ?? 20;
  const volMult = params.volMult ?? 1.5;
  const costPct = params.costPct ?? 0.05; // 0.05% لكل جهة (دخول أو خروج) - تقدير عمولة + سبريد/انزلاق

  if (candles.length < Math.max(emaSlowLen, volAvgLen) + 2) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      trades: [],
    };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const emaFast = ema(closes, emaFastLen);
  const emaSlow = ema(closes, emaSlowLen);
  const vwap = vwapSeries(candles);
  const volAvg = sma(volumes, volAvgLen);

  const trades: Trade[] = [];
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = "";

  let equity = 1; // نبدأ برأس مال افتراضي = 1 (نسبي)
  let peakEquity = 1;
  let maxDrawdown = 0;

  for (let i = 1; i < candles.length; i++) {
    if (Number.isNaN(volAvg[i])) continue;

    const crossUp = emaFast[i - 1] <= emaSlow[i - 1] && emaFast[i] > emaSlow[i];
    const crossDown = emaFast[i - 1] >= emaSlow[i - 1] && emaFast[i] < emaSlow[i];

    const aboveVwap = closes[i] > vwap[i];
    const belowVwap = closes[i] < vwap[i];
    const volHigh = volumes[i] > volAvg[i] * volMult;

    const buySignal = crossUp && aboveVwap && volHigh;
    const sellSignal = crossDown && belowVwap && volHigh;

    if (!inPosition && buySignal) {
      inPosition = true;
      entryPrice = closes[i];
      entryDate = candles[i].timestamp;
    } else if (inPosition && sellSignal) {
      const exitPrice = closes[i];
      // نطرح تكلفة الدخول والخروج (عمولة + انزلاق سعري تقديري) من العائد
      const rawReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const returnPct = rawReturnPct - costPct * 2;

      trades.push({
        entryDate,
        entryPrice,
        exitDate: candles[i].timestamp,
        exitPrice,
        returnPct,
        reason: "EMA crossover + VWAP + حجم",
      });

      equity *= 1 + returnPct / 100;
      peakEquity = Math.max(peakEquity, equity);
      const drawdown = ((peakEquity - equity) / peakEquity) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);

      inPosition = false;
    }
  }

  // لو انتهت البيانات وفيه صفقة لسه مفتوحة، نقفلها افتراضياً على آخر شمعة
  // بدل ما نتجاهلها بالكامل - هذا يمنع تجميل النتيجة بإسقاط صفقة خاسرة لم تُغلق بعد
  if (inPosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const rawReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const returnPct = rawReturnPct - costPct * 2;

    trades.push({
      entryDate,
      entryPrice,
      exitDate: lastCandle.timestamp,
      exitPrice,
      returnPct,
      reason: "إغلاق افتراضي - نهاية بيانات الفترة (ما فيه إشارة خروج بعد)",
      autoClosedAtEnd: true,
    });

    equity *= 1 + returnPct / 100;
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  const winningTrades = trades.filter((t) => t.returnPct > 0).length;
  const losingTrades = trades.filter((t) => t.returnPct <= 0).length;
  const totalReturnPct = (equity - 1) * 100;

  return {
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    winRate: trades.length > 0 ? (winningTrades / trades.length) * 100 : 0,
    totalReturnPct,
    maxDrawdownPct: maxDrawdown,
    trades,
  };
}
