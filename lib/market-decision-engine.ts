import { getTechnicalIndicators } from '@/lib/market-indicators';
import { getTradierQuote } from '@/lib/tradier';

type Timeframe = '15min' | '1h' | '1day';

type Bias =
  | 'CALL_BIAS'
  | 'PUT_BIAS'
  | 'WAIT';

type MarketSymbol =
  | 'SPX'
  | 'SPY'
  | 'QQQ';

function num(value: unknown): number | null {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function hasTechnicalError(
  data: unknown
): data is { error: string } {
  return Boolean(
    data &&
      typeof data === 'object' &&
      'error' in data
  );
}

function readRsi(data: any) {
  return (
    num(data?.rsi?.value) ??
    num(data?.rsi)
  );
}

function readMacdHistogram(data: any) {
  return num(
    data?.macd?.histogram
  );
}

function readPreviousMacdHistogram(
  data: any
) {
  return (
    num(
      data?.macd
        ?.previousHistogram
    ) ??
    num(
      data?.macd
        ?.previous_histogram
    )
  );
}

function readLevels(data: any) {
  const sr =
    data?.supportResistance || {};

  return {
    source:
      sr.source || 'unknown',

    val:
      num(sr.val) ??
      num(sr.support),

    poc:
      num(sr.poc),

    vah:
      num(sr.vah) ??
      num(sr.resistance),
  };
}

function scoreRsi(
  rsi: number | null
) {
  if (rsi === null) {
    return 0;
  }

  if (rsi >= 60) {
    return 5;
  }

  if (rsi >= 52) {
    return 3;
  }

  if (rsi <= 40) {
    return -5;
  }

  if (rsi <= 48) {
    return -3;
  }

  return 0;
}

function scoreMacd(
  current: number | null,
  previous: number | null
) {
  let score = 0;

  const reasons: string[] = [];

  if (current !== null) {
    if (current > 0) {
      score += 4;

      reasons.push(
        'MACD Histogram موجب'
      );
    } else if (current < 0) {
      score -= 4;

      reasons.push(
        'MACD Histogram سالب'
      );
    }
  } else {
    reasons.push(
      'MACD Histogram غير متوفر'
    );
  }

  if (
    current !== null &&
    previous !== null
  ) {
    if (current > previous) {
      score += 3;

      reasons.push(
        'زخم MACD يتحسن مقارنة بالشمعة السابقة'
      );
    } else if (
      current < previous
    ) {
      score -= 3;

      reasons.push(
        'زخم MACD يضعف مقارنة بالشمعة السابقة'
      );
    } else {
      reasons.push(
        'زخم MACD ثابت مقارنة بالشمعة السابقة'
      );
    }
  } else {
    reasons.push(
      'مقارنة MACD مع الشمعة السابقة غير متوفرة'
    );
  }

  return {
    score,
    reasons,
  };
}

function scoreZones(
  price: number | null,
  levels: ReturnType<
    typeof readLevels
  >
) {
  let score = 0;

  const reasons: string[] = [];

  if (price === null) {
    return {
      score,
      reasons: [
        'السعر غير متوفر',
      ],
    };
  }

  if (
    levels.source !==
    'volume_profile'
  ) {
    return {
      score,
      reasons: [
        'Volume Profile غير مؤكد، لذلك وزن المناطق منخفض',
      ],
    };
  }

  if (
    levels.vah !== null &&
    price > levels.vah
  ) {
    score += 8;

    reasons.push(
      `السعر يتداول فوق VAH ${levels.vah}`
    );
  } else if (
    levels.poc !== null &&
    levels.vah !== null &&
    price >= levels.poc &&
    price <= levels.vah
  ) {
    score += 2;

    reasons.push(
      'السعر بين POC وVAH'
    );
  } else if (
    levels.val !== null &&
    levels.poc !== null &&
    price >= levels.val &&
    price < levels.poc
  ) {
    score -= 2;

    reasons.push(
      'السعر بين VAL وPOC'
    );
  } else if (
    levels.val !== null &&
    price < levels.val
  ) {
    score -= 8;

    reasons.push(
      `السعر يتداول تحت VAL ${levels.val}`
    );
  }

  if (levels.poc !== null) {
    if (price > levels.poc) {
      score += 3;
    }

    if (price < levels.poc) {
      score -= 3;
    }
  }

  return {
    score,
    reasons,
  };
}

function scoreDataRisk(
  data: any,
  technicalError: string | null
) {
  if (technicalError) {
    return {
      score: -10,
      reason:
        'فشل جلب البيانات الفنية',
    };
  }

  const freshness =
    data?.dataStatus?.freshness;

  if (freshness === 'stale') {
    return {
      score: -7,
      reason: 'البيانات قديمة',
    };
  }

  if (
    freshness === 'delayed'
  ) {
    return {
      score: -3,
      reason:
        'البيانات متأخرة',
    };
  }

  if (
    freshness === 'historical'
  ) {
    return {
      score: -4,
      reason:
        'البيانات تاريخية وليست لحظية',
    };
  }

  if (
    freshness === 'unknown' ||
    !freshness
  ) {
    return {
      score: -2,
      reason:
        'حداثة البيانات غير مؤكدة',
    };
  }

  return {
    score: 0,
    reason: null,
  };
}

async function analyzeSymbol(
  symbol: MarketSymbol,
  timeframe: Timeframe
) {
  const [
    indicatorsResult,
    quote,
  ] = await Promise.all([
    getTechnicalIndicators(
      symbol,
      timeframe
    ),
    getTradierQuote(symbol),
  ]);

  const technicalError =
    hasTechnicalError(
      indicatorsResult
    )
      ? String(
          indicatorsResult.error
        )
      : null;

  const indicators =
    technicalError === null
      ? indicatorsResult
      : null;

  const quoteError =
    quote &&
    typeof quote === 'object' &&
    'error' in quote
      ? String(
          (quote as any).error
        )
      : null;

  const price =
    num((quote as any)?.last) ??
    num((quote as any)?.close) ??
    num(
      (indicators as any)
        ?.lastPrice
    );

  const rsi =
    readRsi(indicators);

  const macdCurrent =
    readMacdHistogram(
      indicators
    );

  const macdPrevious =
    readPreviousMacdHistogram(
      indicators
    );

  const levels =
    readLevels(indicators);

  const trend = clamp(
    scoreRsi(rsi),
    -10,
    10
  );

  const macd =
    scoreMacd(
      macdCurrent,
      macdPrevious
    );

  const momentum = clamp(
    macd.score,
    -10,
    10
  );

  const zoneResult =
    scoreZones(
      price,
      levels
    );

  const zones = clamp(
    zoneResult.score,
    -10,
    10
  );

  const riskResult =
    scoreDataRisk(
      indicators,
      technicalError
    );

  const risk = clamp(
    riskResult.score,
    -10,
    0
  );

  const technicalDataAvailable =
    technicalError === null;

  const quoteAvailable =
    price !== null;

  return {
    symbol,

    price,

    technicalDataAvailable,

    quoteAvailable,

    technicalError,

    quoteError,

    providerSymbol:
      (indicators as any)
        ?.providerSymbol ??
      null,

    volumeProfileSymbol:
      (indicators as any)
        ?.volumeProfileSymbol ??
      null,

    dataStatus:
      (indicators as any)
        ?.dataStatus ??
      null,

    score:
      trend +
      momentum +
      zones +
      risk,

    components: {
      trend,
      momentum,
      zones,
      risk,
    },

    indicators: {
      rsi,

      macdHistogram:
        macdCurrent,

      previousMacdHistogram:
        macdPrevious,
    },

    levels,

    reasons: [
      ...(technicalError
        ? [
            `فشل جلب مؤشرات ${symbol}: ${technicalError}`,
          ]
        : []),

      ...(quoteError
        ? [
            `فشل جلب سعر ${symbol}: ${quoteError}`,
          ]
        : []),

      rsi !== null
        ? `RSI ${rsi.toFixed(1)}`
        : 'RSI غير متوفر',

      ...macd.reasons,

      ...zoneResult.reasons,

      ...(riskResult.reason
        ? [
            riskResult.reason,
          ]
        : []),

      ...(price === null
        ? [
            `السعر الحالي لـ${symbol} غير متوفر`,
          ]
        : []),
    ],
  };
}

function probabilityFromScore(
  score: number
) {
  return clamp(
    Math.round(
      50 + score * 1.6
    ),
    5,
    95
  );
}

function signAlignment(
  primaryScore: number,
  confirmationScores: number[]
) {
  const primarySign =
    Math.sign(primaryScore);

  if (primarySign === 0) {
    return 0;
  }

  let alignment = 0;

  for (
    const score
    of confirmationScores
  ) {
    if (
      Math.sign(score) ===
      primarySign
    ) {
      alignment +=
        Math.min(
          Math.abs(primaryScore),
          Math.abs(score)
        ) /
        confirmationScores.length;
    } else {
      alignment -=
        Math.abs(
          primaryScore - score
        ) /
        confirmationScores.length;
    }
  }

  return alignment;
}

export async function getMarketDecision(
  timeframe: Timeframe = '15min'
) {
  const [
    spx,
    spy,
    qqq,
  ] = await Promise.all([
    analyzeSymbol(
      'SPX',
      timeframe
    ),

    analyzeSymbol(
      'SPY',
      timeframe
    ),

    analyzeSymbol(
      'QQQ',
      timeframe
    ),
  ]);

  /*
   * SPX هو الأصل الأساسي:
   *
   * SPX = 60%
   * SPY = 25%
   * QQQ = 15%
   */
  const weightedScore =
    spx.score * 0.6 +
    spy.score * 0.25 +
    qqq.score * 0.15;

  const bullish =
    probabilityFromScore(
      weightedScore
    );

  const bearish =
    probabilityFromScore(
      -weightedScore
    );

  const neutral =
    Math.max(
      0,
      100 -
        Math.max(
          bullish,
          bearish
        )
    );

  const spxTechnicalReady =
    spx.technicalDataAvailable &&
    spx.indicators.rsi !== null &&
    spx.indicators
      .macdHistogram !== null;

  const spxLevelsReady =
    spx.levels.val !== null &&
    spx.levels.vah !== null;

  const dataReadyForEntry =
    spxTechnicalReady &&
    spx.quoteAvailable;

  let bias: Bias = 'WAIT';

  if (
    dataReadyForEntry &&
    weightedScore >= 8 &&
    bullish >= 63
  ) {
    bias = 'CALL_BIAS';
  }

  if (
    dataReadyForEntry &&
    weightedScore <= -8 &&
    bearish >= 63
  ) {
    bias = 'PUT_BIAS';
  }

  const callConditions = [
    spx.levels.vah !== null
      ? `صمود SPX فوق VAH ${spx.levels.vah}`
      : 'توفير مستوى مقاومة أو VAH مؤكد على SPX',

    spx.indicators
      .macdHistogram !== null
      ? 'تأكيد زخم MACD الصاعد على SPX'
      : 'توفير MACD الخاص بـSPX',

    spy.levels.vah !== null
      ? `تأكيد SPY فوق VAH ${spy.levels.vah}`
      : null,

    qqq.levels.vah !== null
      ? `تأكيد QQQ فوق VAH ${qqq.levels.vah}`
      : null,
  ].filter(
    (
      value
    ): value is string =>
      Boolean(value)
  );

  const putConditions = [
    spx.levels.val !== null
      ? `كسر SPX مستوى VAL ${spx.levels.val} مع تأكيد`
      : 'توفير مستوى دعم أو VAL مؤكد على SPX',

    spx.indicators
      .macdHistogram !== null
      ? 'تأكيد زخم MACD الهابط على SPX'
      : 'توفير MACD الخاص بـSPX',

    spy.levels.val !== null
      ? `تأكيد SPY تحت VAL ${spy.levels.val}`
      : null,

    qqq.levels.val !== null
      ? `تأكيد QQQ تحت VAL ${qqq.levels.val}`
      : null,
  ].filter(
    (
      value
    ): value is string =>
      Boolean(value)
  );

  const alignmentRaw =
    signAlignment(
      spx.score,
      [
        spy.score,
        qqq.score,
      ]
    );

  const blockingReasons:
    string[] = [];

  if (
    !spx.technicalDataAvailable
  ) {
    blockingReasons.push(
      spx.technicalError
        ? `بيانات SPX الفنية فشلت: ${spx.technicalError}`
        : 'بيانات SPX الفنية غير متوفرة'
    );
  }

  if (
    !spx.quoteAvailable
  ) {
    blockingReasons.push(
      spx.quoteError
        ? `سعر SPX فشل: ${spx.quoteError}`
        : 'سعر SPX غير متوفر'
    );
  }

  if (
    !spxTechnicalReady
  ) {
    blockingReasons.push(
      'RSI أو MACD الخاص بـSPX غير مكتمل'
    );
  }

  if (
    !spxLevelsReady
  ) {
    blockingReasons.push(
      'مستويات VAH وVAL الخاصة بـSPX غير مكتملة'
    );
  }

  if (
    spx.dataStatus
      ?.freshness === 'stale'
  ) {
    blockingReasons.push(
      'بيانات SPX قديمة'
    );
  }

  if (
    spx.dataStatus
      ?.freshness === 'delayed'
  ) {
    blockingReasons.push(
      'بيانات SPX متأخرة'
    );
  }

  const decision =
    !dataReadyForEntry
      ? 'WAIT_TECHNICAL_DATA_UNAVAILABLE'
      : bias === 'WAIT'
        ? 'WAIT'
        : `${bias}_WAIT_FOR_TRIGGER`;

  return {
    underlying: 'SPX',

    timeframe,

    marketScore: clamp(
      Math.round(
        50 +
          weightedScore * 1.6
      ),
      0,
      100
    ),

    probabilities: {
      bullish,
      bearish,
      neutral,
    },

    bias,

    decision,

    opportunity:
      bias === 'WAIT'
        ? 'NO_OPPORTUNITY'
        : 'WAITING_FOR_TRIGGER',

    dataReadyForEntry,

    spxTechnicalReady,

    spxLevelsReady,

    blockingReasons,

    triggerRequired: true,

    triggerRule:
      'قرار SPX يعتمد أولاً على حركة SPX ومستوياته ومؤشراته، ثم يستخدم SPY وQQQ للتأكيد. الانحياز وحده لا يكفي للدخول، ويلزم إغلاق أو صمود أو إعادة اختبار ناجحة مع حجم مناسب.',

    components: {
      trend: clamp(
        Math.round(
          12.5 +
            (
              spx.components
                .trend *
                0.6 +
              spy.components
                .trend *
                0.25 +
              qqq.components
                .trend *
                0.15
            ) *
              1.25
        ),
        0,
        25
      ),

      momentum: clamp(
        Math.round(
          10 +
            spx.components
              .momentum *
              0.6 +
            spy.components
              .momentum *
              0.25 +
            qqq.components
              .momentum *
              0.15
        ),
        0,
        20
      ),

      zones: clamp(
        Math.round(
          10 +
            spx.components
              .zones *
              0.6 +
            spy.components
              .zones *
              0.25 +
            qqq.components
              .zones *
              0.15
        ),
        0,
        20
      ),

      alignment: clamp(
        Math.round(
          10 +
            alignmentRaw
        ),
        0,
        20
      ),

      risk: clamp(
        Math.round(
          15 +
            spx.components
              .risk *
              0.6 +
            spy.components
              .risk *
              0.25 +
            qqq.components
              .risk *
              0.15
        ),
        0,
        15
      ),
    },

    conditions: {
      call:
        callConditions.length
          ? callConditions
          : [
              'اختراق مقاومة واضحة على SPX مع صمود وإعادة اختبار',
            ],

      put:
        putConditions.length
          ? putConditions
          : [
              'كسر دعم واضح على SPX مع إغلاق تأكيدي',
            ],
    },

    primary: spx,

    confirmations: {
      SPY: spy,
      QQQ: qqq,
    },

    legs: {
      SPX: spx,
      SPY: spy,
      QQQ: qqq,
    },

    disclaimer:
      'هذه قراءة احتمالية وليست ضماناً للصعود أو الهبوط، ولا تُعد أمراً للدخول.',
  };
}
