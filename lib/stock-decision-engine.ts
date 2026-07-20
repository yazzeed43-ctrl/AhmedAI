import { getTechnicalIndicators } from '@/lib/market-indicators';
import { getTradierQuote } from '@/lib/tradier';
import { getMarketDecision } from '@/lib/market-decision-engine';

type Timeframe = '15min' | '1h' | '1day';
type StockBias = 'CALL_BIAS' | 'PUT_BIAS' | 'WAIT';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProbabilities(
  bullishRaw: number,
  bearishRaw: number,
  neutralRaw: number
) {
  const total = bullishRaw + bearishRaw + neutralRaw || 1;

  let bullish = Math.round((bullishRaw / total) * 100);
  let bearish = Math.round((bearishRaw / total) * 100);
  let neutral = 100 - bullish - bearish;

  if (neutral < 0) {
    neutral = 0;
    const directional = bullish + bearish || 1;
    bullish = Math.round((bullish / directional) * 100);
    bearish = 100 - bullish;
  }

  return { bullish, bearish, neutral };
}

function scoreRsi(rsi: number | null) {
  if (rsi === null) {
    return { score: 0, reasons: ['RSI غير متوفر'] };
  }

  if (rsi >= 70) {
    return {
      score: 1,
      reasons: [`RSI ${rsi.toFixed(1)} قوي لكن قريب من التشبع الشرائي`],
    };
  }

  if (rsi >= 60) {
    return {
      score: 8,
      reasons: [`RSI ${rsi.toFixed(1)} يدعم زخمًا صاعدًا قويًا`],
    };
  }

  if (rsi >= 52) {
    return {
      score: 5,
      reasons: [`RSI ${rsi.toFixed(1)} يميل للصعود`],
    };
  }

  if (rsi <= 30) {
    return {
      score: -1,
      reasons: [`RSI ${rsi.toFixed(1)} متشبع بيعيًا وقد يظهر ارتداد`],
    };
  }

  if (rsi <= 40) {
    return {
      score: -8,
      reasons: [`RSI ${rsi.toFixed(1)} يعكس زخمًا هابطًا قويًا`],
    };
  }

  if (rsi <= 48) {
    return {
      score: -5,
      reasons: [`RSI ${rsi.toFixed(1)} يميل للهبوط`],
    };
  }

  return {
    score: 0,
    reasons: [`RSI ${rsi.toFixed(1)} محايد`],
  };
}

function scoreMacd(current: number | null, previous: number | null) {
  let score = 0;
  const reasons: string[] = [];

  if (current === null) {
    return {
      score: 0,
      reasons: ['MACD Histogram غير متوفر'],
    };
  }

  if (current > 0) {
    score += 5;
    reasons.push('MACD Histogram موجب');
  } else if (current < 0) {
    score -= 5;
    reasons.push('MACD Histogram سالب');
  }

  if (previous !== null) {
    if (current > previous) {
      score += 4;
      reasons.push('زخم MACD يتحسن مقارنة بالشمعة السابقة');
    } else if (current < previous) {
      score -= 4;
      reasons.push('زخم MACD يضعف مقارنة بالشمعة السابقة');
    }
  } else {
    reasons.push('لا تتوفر مقارنة مؤكدة مع MACD السابق');
  }

  return {
    score: clamp(score, -10, 10),
    reasons,
  };
}

function scoreBollinger(positionPercent: number | null) {
  if (positionPercent === null) {
    return {
      score: 0,
      reasons: ['موقع السعر داخل Bollinger غير متوفر'],
    };
  }

  if (positionPercent >= 85) {
    return {
      score: 1,
      reasons: ['السعر قريب جدًا من الحد العلوي لبولينجر؛ احتمال امتداد أو جني أرباح'],
    };
  }

  if (positionPercent >= 60) {
    return {
      score: 4,
      reasons: ['السعر في النصف العلوي من Bollinger'],
    };
  }

  if (positionPercent <= 15) {
    return {
      score: -1,
      reasons: ['السعر قريب جدًا من الحد السفلي؛ احتمال استمرار ضعف أو ارتداد'],
    };
  }

  if (positionPercent <= 40) {
    return {
      score: -4,
      reasons: ['السعر في النصف السفلي من Bollinger'],
    };
  }

  return {
    score: 0,
    reasons: ['السعر قريب من منتصف Bollinger'],
  };
}

function readLevels(indicators: any) {
  const sr = indicators?.supportResistance || {};

  return {
    source: sr.source || 'unknown',
    val: num(sr.val) ?? num(sr.support),
    poc: num(sr.poc),
    vah: num(sr.vah) ?? num(sr.resistance),
    support: num(sr.support),
    resistance: num(sr.resistance),
  };
}

function scoreLocation(price: number | null, levels: ReturnType<typeof readLevels>) {
  let score = 0;
  const reasons: string[] = [];

  if (price === null) {
    return {
      score: 0,
      reasons: ['السعر الحالي غير متوفر'],
    };
  }

  if (levels.source === 'volume_profile') {
    if (levels.vah !== null && price > levels.vah) {
      score += 8;
      reasons.push(`السعر يتداول فوق VAH ${levels.vah}`);
    } else if (
      levels.poc !== null &&
      levels.vah !== null &&
      price >= levels.poc &&
      price <= levels.vah
    ) {
      score += 3;
      reasons.push('السعر بين POC وVAH');
    } else if (
      levels.val !== null &&
      levels.poc !== null &&
      price >= levels.val &&
      price < levels.poc
    ) {
      score -= 3;
      reasons.push('السعر بين VAL وPOC');
    } else if (levels.val !== null && price < levels.val) {
      score -= 8;
      reasons.push(`السعر يتداول تحت VAL ${levels.val}`);
    }

    if (levels.poc !== null) {
      if (price > levels.poc) score += 3;
      if (price < levels.poc) score -= 3;
    }
  } else {
    reasons.push(
      'Volume Profile الحقيقي غير متوفر؛ تم خفض وزن المناطق السعرية'
    );

    if (levels.resistance !== null && price > levels.resistance) {
      score += 4;
      reasons.push('السعر فوق المقاومة التاريخية التقريبية');
    } else if (levels.support !== null && price < levels.support) {
      score -= 4;
      reasons.push('السعر تحت الدعم التاريخي التقريبي');
    }
  }

  return {
    score: clamp(score, -12, 12),
    reasons,
  };
}

function scoreFreshness(indicators: any, quote: any) {
  let score = 0;
  const reasons: string[] = [];

  const indicatorFreshness = indicators?.dataStatus?.freshness;
  const quoteFreshness = quote?.freshness;

  if (indicatorFreshness === 'stale') {
    score -= 7;
    reasons.push('شموع المؤشرات قديمة');
  } else if (indicatorFreshness === 'delayed') {
    score -= 3;
    reasons.push('شموع المؤشرات متأخرة');
  } else if (indicatorFreshness === 'unknown' || !indicatorFreshness) {
    score -= 1;
    reasons.push('حداثة شموع المؤشرات غير مؤكدة');
  }

  if (quoteFreshness === 'stale') {
    score -= 5;
    reasons.push('سعر Tradier قديم');
  } else if (quoteFreshness === 'delayed') {
    score -= 2;
    reasons.push('سعر Tradier قد يكون متأخرًا');
  } else if (quoteFreshness === 'unknown') {
    score -= 1;
    reasons.push('حداثة سعر Tradier غير مؤكدة');
  }

  return {
    score: clamp(score, -10, 0),
    reasons,
  };
}

function scoreMarketAlignment(
  stockDirectionalScore: number,
  market: any
) {
  const marketScore = num(market?.marketScore) ?? 50;
  const marketDirectionalScore = marketScore - 50;

  let score = 0;
  const reasons: string[] = [];

  if (stockDirectionalScore > 0 && marketDirectionalScore > 0) {
    score = 8;
    reasons.push('اتجاه السهم متوافق مع انحياز السوق الصاعد');
  } else if (stockDirectionalScore < 0 && marketDirectionalScore < 0) {
    score = -8;
    reasons.push('اتجاه السهم متوافق مع انحياز السوق الهابط');
  } else if (
    Math.abs(stockDirectionalScore) >= 8 &&
    Math.sign(stockDirectionalScore) !== Math.sign(marketDirectionalScore) &&
    Math.abs(marketDirectionalScore) >= 5
  ) {
    score = stockDirectionalScore > 0 ? -5 : 5;
    reasons.push('السهم يتحرك عكس انحياز السوق؛ الصفقة تحتاج حذرًا أكبر');
  } else {
    reasons.push('السوق العام محايد أو غير حاسم بالنسبة للسهم');
  }

  return { score, reasons };
}

function buildLevels(
  bias: StockBias,
  price: number | null,
  levels: ReturnType<typeof readLevels>
) {
  const trigger: string[] = [];
  const invalidation: string[] = [];
  const targets: number[] = [];

  if (bias === 'CALL_BIAS') {
    if (levels.vah !== null) {
      trigger.push(`إغلاق وصمود فوق ${levels.vah} (VAH)`);
      targets.push(Number((levels.vah * 1.005).toFixed(2)));
    } else if (levels.resistance !== null) {
      trigger.push(`إغلاق وصمود فوق المقاومة ${levels.resistance}`);
      targets.push(Number((levels.resistance * 1.005).toFixed(2)));
    }

    if (levels.poc !== null) {
      invalidation.push(`العودة والثبات تحت POC ${levels.poc}`);
    } else if (levels.support !== null) {
      invalidation.push(`كسر الدعم ${levels.support}`);
    }

    if (price !== null) {
      targets.push(
        Number((price * 1.01).toFixed(2)),
        Number((price * 1.02).toFixed(2))
      );
    }
  } else if (bias === 'PUT_BIAS') {
    if (levels.val !== null) {
      trigger.push(`كسر وإغلاق تحت ${levels.val} (VAL)`);
      targets.push(Number((levels.val * 0.995).toFixed(2)));
    } else if (levels.support !== null) {
      trigger.push(`كسر وإغلاق تحت الدعم ${levels.support}`);
      targets.push(Number((levels.support * 0.995).toFixed(2)));
    }

    if (levels.poc !== null) {
      invalidation.push(`العودة والثبات فوق POC ${levels.poc}`);
    } else if (levels.resistance !== null) {
      invalidation.push(`اختراق المقاومة ${levels.resistance}`);
    }

    if (price !== null) {
      targets.push(
        Number((price * 0.99).toFixed(2)),
        Number((price * 0.98).toFixed(2))
      );
    }
  } else {
    if (levels.vah !== null) {
      trigger.push(`CALL فقط بعد الصمود فوق VAH ${levels.vah}`);
    }
    if (levels.val !== null) {
      trigger.push(`PUT فقط بعد كسر VAL ${levels.val} مع تأكيد`);
    }
    invalidation.push('لا يوجد سيناريو مفعّل حاليًا');
  }

  return {
    trigger: trigger.length
      ? trigger
      : ['انتظر كسرًا واضحًا لمقاومة أو دعم مع إغلاق تأكيدي'],
    invalidation,
    targets: [...new Set(targets)].slice(0, 3),
  };
}

export async function getStockDecision(
  symbol: string,
  timeframe: Timeframe = '15min'
) {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(normalizedSymbol)) {
    return {
      error: 'صيغة رمز السهم غير صحيحة',
    };
  }

  const [indicators, quote, market] = await Promise.all([
    getTechnicalIndicators(normalizedSymbol, timeframe),
    getTradierQuote(normalizedSymbol),
    getMarketDecision(timeframe),
  ]);

  if ('error' in indicators) {
    return {
      error: indicators.error,
    };
  }

  const price =
    num(quote?.last) ??
    num(quote?.close) ??
    num(indicators.lastPrice);

  const rsi = scoreRsi(num(indicators.rsi?.value));
  const macd = scoreMacd(
    num(indicators.macd?.histogram),
    num(indicators.macd?.previousHistogram)
  );
  const bollinger = scoreBollinger(
    num(indicators.bollingerBands?.positionPercent)
  );
  const levels = readLevels(indicators);
  const location = scoreLocation(price, levels);
  const freshness = scoreFreshness(indicators, quote);

  const technicalDirectionalScore =
    rsi.score +
    macd.score +
    bollinger.score +
    location.score;

  const marketAlignment = scoreMarketAlignment(
    technicalDirectionalScore,
    market
  );

  const directionalScore = clamp(
    technicalDirectionalScore + marketAlignment.score + freshness.score,
    -35,
    35
  );

  let bias: StockBias = 'WAIT';

  if (directionalScore >= 10) {
    bias = 'CALL_BIAS';
  } else if (directionalScore <= -10) {
    bias = 'PUT_BIAS';
  }

  const neutralWeight = clamp(
    35 - Math.abs(directionalScore),
    10,
    45
  );

  const bullishRaw =
    directionalScore > 0
      ? 50 + directionalScore * 1.4
      : 25;

  const bearishRaw =
    directionalScore < 0
      ? 50 + Math.abs(directionalScore) * 1.4
      : 25;

  const probabilities = normalizeProbabilities(
    bullishRaw,
    bearishRaw,
    neutralWeight
  );

  const confidence = clamp(
    Math.round(
      50 +
        Math.abs(directionalScore) * 1.2 -
        (freshness.score < 0 ? Math.abs(freshness.score) * 2 : 0)
    ),
    35,
    92
  );

  const stockScore = clamp(
    Math.round(50 + directionalScore * 1.4),
    0,
    100
  );

  const decision =
    bias === 'WAIT'
      ? 'WAIT'
      : `${bias}_WAIT_FOR_TRIGGER`;

  const levelsPlan = buildLevels(bias, price, levels);

  return {
    symbol: normalizedSymbol,
    timeframe,
    price,
    stockScore,
    probabilities,
    bias,
    decision,
    confidence,
    triggerRequired: true,
    components: {
      trendAndRsi: {
        score: clamp(12 + rsi.score, 0, 25),
        max: 25,
      },
      momentum: {
        score: clamp(10 + macd.score, 0, 20),
        max: 20,
      },
      location: {
        score: clamp(10 + location.score, 0, 20),
        max: 20,
      },
      marketAlignment: {
        score: clamp(10 + marketAlignment.score, 0, 20),
        max: 20,
      },
      riskAndFreshness: {
        score: clamp(15 + freshness.score, 0, 15),
        max: 15,
      },
    },
    reasons: {
      bullish: [
        ...rsi.reasons.filter((reason) => rsi.score > 0),
        ...macd.reasons.filter(() => macd.score > 0),
        ...bollinger.reasons.filter(() => bollinger.score > 0),
        ...location.reasons.filter(() => location.score > 0),
        ...marketAlignment.reasons.filter(
          () => marketAlignment.score > 0
        ),
      ],
      bearish: [
        ...rsi.reasons.filter((reason) => rsi.score < 0),
        ...macd.reasons.filter(() => macd.score < 0),
        ...bollinger.reasons.filter(() => bollinger.score < 0),
        ...location.reasons.filter(() => location.score < 0),
        ...marketAlignment.reasons.filter(
          () => marketAlignment.score < 0
        ),
      ],
      risks: freshness.reasons,
    },
    levels,
    trigger: levelsPlan.trigger,
    invalidation: levelsPlan.invalidation,
    targets: levelsPlan.targets,
    marketContext: {
      marketScore: market?.marketScore ?? null,
      marketBias: market?.bias ?? null,
      marketDecision: market?.decision ?? null,
    },
    disclaimer:
      'هذه قراءة احتمالية وليست ضمانًا للصعود أو الهبوط. لا يتحول الانحياز إلى دخول إلا بعد Trigger واضح.',
  };
}
