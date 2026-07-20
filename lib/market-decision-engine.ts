import { getTechnicalIndicators } from '@/lib/market-indicators';
import { getTradierQuote } from '@/lib/tradier';

type Timeframe = '15min' | '1h' | '1day';
type Bias = 'CALL_BIAS' | 'PUT_BIAS' | 'WAIT';

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readRsi(data: any) {
  return num(data?.rsi?.value) ?? num(data?.rsi);
}

function readMacdHistogram(data: any) {
  return num(data?.macd?.histogram);
}

function readPreviousMacdHistogram(data: any) {
  return (
    num(data?.macd?.previousHistogram) ??
    num(data?.macd?.previous_histogram)
  );
}

function readLevels(data: any) {
  const sr = data?.supportResistance || {};
  return {
    source: sr.source || 'unknown',
    val: num(sr.val) ?? num(sr.support),
    poc: num(sr.poc),
    vah: num(sr.vah) ?? num(sr.resistance),
  };
}

function scoreRsi(rsi: number | null) {
  if (rsi === null) return 0;
  if (rsi >= 60) return 5;
  if (rsi >= 52) return 3;
  if (rsi <= 40) return -5;
  if (rsi <= 48) return -3;
  return 0;
}

function scoreMacd(current: number | null, previous: number | null) {
  let score = 0;
  const reasons: string[] = [];

  if (current !== null) {
    if (current > 0) {
      score += 4;
      reasons.push('MACD Histogram موجب');
    } else if (current < 0) {
      score -= 4;
      reasons.push('MACD Histogram سالب');
    }
  }

  if (current !== null && previous !== null) {
    if (current > previous) {
      score += 3;
      reasons.push('زخم MACD يتحسن مقارنة بالشمعة السابقة');
    } else if (current < previous) {
      score -= 3;
      reasons.push('زخم MACD يضعف مقارنة بالشمعة السابقة');
    }
  } else {
    reasons.push('مقارنة MACD مع الشمعة السابقة غير متوفرة');
  }

  return { score, reasons };
}

function scoreZones(price: number | null, levels: ReturnType<typeof readLevels>) {
  let score = 0;
  const reasons: string[] = [];

  if (price === null) {
    return { score, reasons: ['السعر غير متوفر'] };
  }

  if (levels.source !== 'volume_profile') {
    return {
      score,
      reasons: ['Volume Profile غير مؤكد، لذلك وزن المناطق منخفض'],
    };
  }

  if (levels.vah !== null && price > levels.vah) {
    score += 8;
    reasons.push(`السعر يتداول فوق VAH ${levels.vah}`);
  } else if (
    levels.poc !== null &&
    levels.vah !== null &&
    price >= levels.poc &&
    price <= levels.vah
  ) {
    score += 2;
    reasons.push('السعر بين POC وVAH');
  } else if (
    levels.val !== null &&
    levels.poc !== null &&
    price >= levels.val &&
    price < levels.poc
  ) {
    score -= 2;
    reasons.push('السعر بين VAL وPOC');
  } else if (levels.val !== null && price < levels.val) {
    score -= 8;
    reasons.push(`السعر يتداول تحت VAL ${levels.val}`);
  }

  if (levels.poc !== null) {
    if (price > levels.poc) score += 3;
    if (price < levels.poc) score -= 3;
  }

  return { score, reasons };
}

function scoreDataRisk(data: any) {
  const freshness = data?.dataStatus?.freshness;
  if (freshness === 'stale') return { score: -7, reason: 'البيانات قديمة' };
  if (freshness === 'delayed') return { score: -3, reason: 'البيانات متأخرة' };
  if (!freshness) return { score: -1, reason: 'حداثة البيانات غير مؤكدة' };
  return { score: 0, reason: null };
}

async function analyzeSymbol(symbol: 'SPY' | 'QQQ', timeframe: Timeframe) {
  const [indicators, quote] = await Promise.all([
    getTechnicalIndicators(symbol, timeframe),
    getTradierQuote(symbol),
  ]);

  const price =
    num(quote?.last) ??
    num(quote?.close) ??
    num(indicators?.price);

  const rsi = readRsi(indicators);
  const macdCurrent = readMacdHistogram(indicators);
  const macdPrevious = readPreviousMacdHistogram(indicators);
  const levels = readLevels(indicators);

  const trend = clamp(scoreRsi(rsi), -10, 10);
  const macd = scoreMacd(macdCurrent, macdPrevious);
  const momentum = clamp(macd.score, -10, 10);
  const zoneResult = scoreZones(price, levels);
  const zones = clamp(zoneResult.score, -10, 10);
  const riskResult = scoreDataRisk(indicators);
  const risk = clamp(riskResult.score, -10, 0);

  return {
    symbol,
    price,
    score: trend + momentum + zones + risk,
    components: { trend, momentum, zones, risk },
    indicators: {
      rsi,
      macdHistogram: macdCurrent,
      previousMacdHistogram: macdPrevious,
    },
    levels,
    reasons: [
      rsi !== null ? `RSI ${rsi.toFixed(1)}` : 'RSI غير متوفر',
      ...macd.reasons,
      ...zoneResult.reasons,
      ...(riskResult.reason ? [riskResult.reason] : []),
    ],
  };
}

function probabilityFromScore(score: number) {
  return clamp(Math.round(50 + score * 1.6), 5, 95);
}

export async function getMarketDecision(timeframe: Timeframe = '15min') {
  const [spy, qqq] = await Promise.all([
    analyzeSymbol('SPY', timeframe),
    analyzeSymbol('QQQ', timeframe),
  ]);

  const weightedScore = spy.score * 0.4 + qqq.score * 0.6;
  const bullish = probabilityFromScore(weightedScore);
  const bearish = probabilityFromScore(-weightedScore);
  const neutral = Math.max(0, 100 - Math.max(bullish, bearish));

  let bias: Bias = 'WAIT';
  if (weightedScore >= 8 && bullish >= 63) bias = 'CALL_BIAS';
  if (weightedScore <= -8 && bearish >= 63) bias = 'PUT_BIAS';

  const callConditions = [
    spy.levels.vah !== null ? `صمود SPY فوق VAH ${spy.levels.vah}` : null,
    qqq.levels.vah !== null ? `صمود QQQ فوق VAH ${qqq.levels.vah}` : null,
  ].filter(Boolean);

  const putConditions = [
    spy.levels.val !== null ? `كسر SPY مستوى VAL ${spy.levels.val} مع تأكيد` : null,
    qqq.levels.val !== null ? `كسر QQQ مستوى VAL ${qqq.levels.val} مع تأكيد` : null,
  ].filter(Boolean);

  const alignmentRaw =
    Math.sign(spy.score) === Math.sign(qqq.score)
      ? Math.min(Math.abs(spy.score), Math.abs(qqq.score))
      : -Math.abs(spy.score - qqq.score) / 2;

  return {
    timeframe,
    marketScore: clamp(Math.round(50 + weightedScore * 1.6), 0, 100),
    probabilities: { bullish, bearish, neutral },
    bias,
    decision: bias === 'WAIT' ? 'WAIT' : `${bias}_WAIT_FOR_TRIGGER`,
    triggerRequired: true,
    triggerRule:
      'الانحياز وحده لا يكفي للدخول. يلزم إغلاق أو صمود على فريم الدخول أو إعادة اختبار ناجحة مع حجم مناسب.',
    components: {
      trend: clamp(
        Math.round(12.5 + (spy.components.trend * 0.4 + qqq.components.trend * 0.6) * 1.25),
        0,
        25
      ),
      momentum: clamp(
        Math.round(10 + spy.components.momentum * 0.4 + qqq.components.momentum * 0.6),
        0,
        20
      ),
      zones: clamp(
        Math.round(10 + spy.components.zones * 0.4 + qqq.components.zones * 0.6),
        0,
        20
      ),
      alignment: clamp(Math.round(10 + alignmentRaw), 0, 20),
      risk: clamp(
        Math.round(15 + spy.components.risk * 0.4 + qqq.components.risk * 0.6),
        0,
        15
      ),
    },
    conditions: {
      call: callConditions.length
        ? callConditions
        : ['اختراق مقاومة واضحة مع صمود وإعادة اختبار'],
      put: putConditions.length
        ? putConditions
        : ['كسر دعم واضح مع إغلاق تأكيدي'],
    },
    legs: { SPY: spy, QQQ: qqq },
    disclaimer:
      'هذه قراءة احتمالية وليست ضماناً للصعود أو الهبوط، ولا تُعد أمراً للدخول.',
  };
}
