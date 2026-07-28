import type {
  TradeEngineReport,
} from '@/lib/trading/trade-engine';

import {
  getRecentSocialSignals,
} from '@/lib/social/social-signals';

export type SocialSignal = {
  id?: string | number | null;
  message_id?: string | null;
  symbol?: string | null;
  symbols?: string[] | null;
  content?: string | null;
  content_type?: string | null;
  content_types?: string[] | null;
  market_impact?: string | null;
  sentiment?: string | null;
  confidence?: number | null;
  reliability_score?: number | null;
  published_at?: string | null;
};

export type ReliabilityWeightSummary = {
  averageReliability: number;
  minimumReliability: number;
  maximumReliability: number;
  weightedSignalsCount: number;
};

export type SocialDecisionContext = {
  symbol: string;
  totalSignals: number;
  symbolSignalsCount: number;
  marketSignalsCount: number;
  expiredSignalsCount: number;
  highImpactCount: number;
  pendingHighImpactCount: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  confidenceAdjustment: number;
  forcedWait: boolean;
  conflict: boolean;
  reasons: string[];
  warnings: string[];
  events: SocialSignal[];
  reliability: ReliabilityWeightSummary;
};

export type SociallyAdjustedTradeReport =
  TradeEngineReport & {
    socialIntelligence: SocialDecisionContext;
  };

function includesContentType(
  signal: SocialSignal,
  type: string
): boolean {
  return (
    signal.content_type === type ||
    signal.content_types?.includes(type) === true
  );
}

function isPendingHighImpactEvent(
  signal: SocialSignal
): boolean {
  if (signal.market_impact !== 'HIGH') {
    return false;
  }

  const isEvent =
    includesContentType(signal, 'EARNINGS') ||
    includesContentType(signal, 'FED');

  if (!isEvent) {
    return false;
  }

  return (
    signal.sentiment === 'neutral' ||
    !signal.sentiment
  );
}

function getDirectionLabel(
  decision: TradeEngineReport['decision']
): string {
  const labels: Record<
    TradeEngineReport['decision'],
    string
  > = {
    BUY_CALL: 'شراء عقد كول',
    BUY_PUT: 'شراء عقد بوت',
    WATCH: 'مراقبة وانتظار التأكيد',
    WAIT: 'انتظار وعدم الدخول',
    REJECT_CONTRACT: 'رفض العقد',
  };

  return labels[decision];
}

function getSignalKey(
  signal: SocialSignal
): string {
  return String(
    signal.id ??
      signal.message_id ??
      [
        signal.symbol ?? '',
        signal.published_at ?? '',
        signal.content ?? '',
      ].join('|')
  );
}

function mergeUniqueSignals(
  groups: SocialSignal[][]
): SocialSignal[] {
  const unique = new Map<string, SocialSignal>();

  for (const signal of groups.flat()) {
    unique.set(getSignalKey(signal), signal);
  }

  return [...unique.values()].sort((a, b) => {
    const aTime = a.published_at
      ? new Date(a.published_at).getTime()
      : 0;

    const bTime = b.published_at
      ? new Date(b.published_at).getTime()
      : 0;

    return bTime - aTime;
  });
}

function isMarketWideSignal(
  signal: SocialSignal
): boolean {
  const symbols =
    signal.symbols?.length
      ? signal.symbols
      : signal.symbol
        ? [signal.symbol]
        : [];

  return (
    symbols.includes('SPY') ||
    symbols.includes('QQQ') ||
    symbols.includes('SPX')
  );
}

async function loadDecisionSignals(params: {
  symbol: string;
  minutes: number;
  limit: number;
}): Promise<{
  symbolSignals: SocialSignal[];
  marketSignals: SocialSignal[];
  allSignals: SocialSignal[];
}> {
  const requestedSymbols = [
    params.symbol,
    'SPY',
    'QQQ',
  ];

  const results = await Promise.all(
    requestedSymbols.map(async (symbol) => {
      return (await getRecentSocialSignals({
        symbol,
        minutes: params.minutes,
        limit: params.limit,
      })) as SocialSignal[];
    })
  );

  const symbolSignals = results[0] ?? [];

  const marketSignals = mergeUniqueSignals([
    results[1] ?? [],
    results[2] ?? [],
  ]).filter(isMarketWideSignal);

  const allSignals = mergeUniqueSignals([
    symbolSignals,
    marketSignals,
  ]).slice(0, params.limit);

  return {
    symbolSignals,
    marketSignals,
    allSignals,
  };
}


function getSignalLifetimeMinutes(
  signal: SocialSignal
): number {
  if (
    includesContentType(signal, 'EARNINGS') ||
    includesContentType(signal, 'FED')
  ) {
    return 1440;
  }

  if (
    includesContentType(signal, 'BREAKING') ||
    signal.market_impact === 'HIGH'
  ) {
    return 360;
  }

  if (
    includesContentType(signal, 'WHALE') ||
    (signal.content ?? '')
      .toUpperCase()
      .includes('TARGET PRICE') ||
    (signal.content ?? '')
      .toUpperCase()
      .includes('PRICE TARGET') ||
    (signal.content ?? '')
      .toUpperCase()
      .includes('UPGRADE') ||
    (signal.content ?? '')
      .toUpperCase()
      .includes('DOWNGRADE')
  ) {
    return 480;
  }

  if (includesContentType(signal, 'SIGNAL')) {
    return 120;
  }

  return 240;
}

function getSignalAgeMinutes(
  signal: SocialSignal
): number {
  if (!signal.published_at) {
    return Number.POSITIVE_INFINITY;
  }

  const publishedAt =
    new Date(signal.published_at).getTime();

  if (!Number.isFinite(publishedAt)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    (Date.now() - publishedAt) / 60_000
  );
}

function isSignalActive(
  signal: SocialSignal
): boolean {
  return (
    getSignalAgeMinutes(signal) <=
    getSignalLifetimeMinutes(signal)
  );
}

export function normalizeReliability(
  value: number | null | undefined
): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, Number(value)));
}

export function getAverageReliability(
  signals: SocialSignal[]
): number {
  if (signals.length === 0) {
    return 0;
  }

  const total = signals.reduce(
    (sum, signal) =>
      sum +
      normalizeReliability(
        signal.reliability_score
      ),
    0
  );

  return total / signals.length;
}

export function getReliabilitySummary(
  signals: SocialSignal[]
): ReliabilityWeightSummary {
  if (signals.length === 0) {
    return {
      averageReliability: 0,
      minimumReliability: 0,
      maximumReliability: 0,
      weightedSignalsCount: 0,
    };
  }

  const normalized = signals.map((signal) =>
    normalizeReliability(signal.reliability_score)
  );

  return {
    averageReliability:
      normalized.reduce((sum, value) => sum + value, 0) /
      normalized.length,
    minimumReliability: Math.min(...normalized),
    maximumReliability: Math.max(...normalized),
    weightedSignalsCount: signals.length,
  };
}

// وزن مقدار التعديل حسب متوسط موثوقية مصادره، مع حد أدنى بمقدار 1
// حتى لا يختفي أثر مصدر موثوقيته جزئية بالكامل (مثال: 0.2 يعطي ±1 بدل صفر).
export function weightedAdjustment(
  base: number,
  reliability: number
): number {
  const magnitude = Math.max(
    1,
    Math.round(Math.abs(base) * reliability)
  );

  return base < 0 ? -magnitude : magnitude;
}

function updateSummary(
  report: TradeEngineReport,
  context: SocialDecisionContext
): string {
  let summary = report.summary;

  summary = summary.replace(
    /^القرار:.*$/m,
    `القرار: ${getDirectionLabel(report.decision)}`
  );

  summary = summary.replace(
    /^الثقة:.*$/m,
    `الثقة: ${report.confidence}%`
  );

  const socialLines = [
    '',
    'الذكاء الاجتماعي:',
    `أحداث الرمز: ${context.symbolSignalsCount}`,
    `أخبار السوق العامة: ${context.marketSignalsCount}`,
    `إجمالي الأحداث المستخدمة: ${context.totalSignals}`,
    `الأحداث المنتهية المستبعدة: ${context.expiredSignalsCount}`,
    `الأحداث مرتفعة التأثير: ${context.highImpactCount}`,
    `الأحداث المعلقة مرتفعة التأثير: ${context.pendingHighImpactCount}`,
    `تعديل الثقة: ${
      context.confidenceAdjustment >= 0 ? '+' : ''
    }${context.confidenceAdjustment}%`,
    `متوسط موثوقية المصادر: ${Math.round(
      context.reliability.averageReliability * 100
    )}%`,
  ];

  if (context.reasons.length > 0) {
    socialLines.push(
      `أسباب التأثير: ${context.reasons.join('، ')}`
    );
  }

  if (context.warnings.length > 0) {
    socialLines.push(
      `تحذيرات اجتماعية: ${context.warnings.join('، ')}`
    );
  }

  return `${summary}\n${socialLines.join('\n')}`;
}

type SignalLoader = typeof loadDecisionSignals;

export async function applySocialIntelligenceToTradeReport(
  report: TradeEngineReport,
  params?: {
    minutes?: number;
    limit?: number;
  },
  deps?: {
    loadSignals?: SignalLoader;
  }
): Promise<SociallyAdjustedTradeReport> {
  const minutes = params?.minutes ?? 1440;
  const limit = params?.limit ?? 50;
  const loadSignals = deps?.loadSignals ?? loadDecisionSignals;

  const {
    symbolSignals,
    marketSignals,
    allSignals,
  } = await loadSignals({
    symbol: report.symbol,
    minutes,
    limit,
  });

  const signals =
    allSignals.filter(isSignalActive);

  const expiredSignalsCount =
    allSignals.length - signals.length;

  const activeSymbolSignals =
    symbolSignals.filter(isSignalActive);

  const activeMarketSignals =
    marketSignals.filter(isSignalActive);

  const highImpact = signals.filter(
    (signal) =>
      signal.market_impact === 'HIGH'
  );

  const pendingHighImpact = highImpact.filter(
    isPendingHighImpactEvent
  );

  const bullish = signals.filter(
    (signal) =>
      signal.sentiment === 'bullish'
  );

  const bearish = signals.filter(
    (signal) =>
      signal.sentiment === 'bearish'
  );

  const neutral = signals.filter(
    (signal) =>
      signal.sentiment === 'neutral' ||
      !signal.sentiment
  );

  const reasons: string[] = [];
  const warnings: string[] = [];

  let confidenceAdjustment = 0;
  let forcedWait = false;
  let conflict = false;

  const tradeDirection =
    report.contract.optionType === 'CALL'
      ? 'bullish'
      : 'bearish';

  if (pendingHighImpact.length > 0) {
    const pendingReliability =
      getAverageReliability(pendingHighImpact);

    const pendingAdjustment = weightedAdjustment(
      -10,
      pendingReliability
    );

    confidenceAdjustment += pendingAdjustment;
    forcedWait = true;

    const pendingSymbols = [
      ...new Set(
        pendingHighImpact.flatMap(
          (signal) =>
            signal.symbols?.length
              ? signal.symbols
              : signal.symbol
                ? [signal.symbol]
                : []
        )
      ),
    ];

    warnings.push(
      `يوجد حدث مرتفع التأثير لم يصدر اتجاهه النهائي${
        pendingSymbols.length > 0
          ? ` على ${pendingSymbols.join(', ')}`
          : ''
      }`
    );

    reasons.push(
      `تم تخفيض الثقة ${Math.abs(
        pendingAdjustment
      )}% حسب موثوقية المصدر حتى اتضاح نتيجة الحدث أو التوجيهات`
    );
  } else {
    const alignedHighImpact = highImpact.filter(
      (signal) =>
        signal.sentiment === tradeDirection
    );

    const conflictingHighImpact = highImpact.filter(
      (signal) =>
        signal.sentiment &&
        signal.sentiment !== 'neutral' &&
        signal.sentiment !== tradeDirection
    );

    if (conflictingHighImpact.length > 0) {
      conflict = true;

      const conflictingReliability =
        getAverageReliability(conflictingHighImpact);

      const conflictingAdjustment = weightedAdjustment(
        -10,
        conflictingReliability
      );

      confidenceAdjustment += conflictingAdjustment;
      forcedWait = true;

      warnings.push(
        'يوجد خبر مرتفع التأثير يتعارض مع اتجاه الصفقة'
      );

      reasons.push(
        `تم تحويل القرار إلى انتظار بسبب تعارض الحدث مع اتجاه العقد (خفض ${Math.abs(
          conflictingAdjustment
        )}% حسب موثوقية المصدر)`
      );
    } else if (alignedHighImpact.length > 0) {
      const alignedReliability =
        getAverageReliability(alignedHighImpact);

      const alignedAdjustment = weightedAdjustment(
        5,
        alignedReliability
      );

      confidenceAdjustment += alignedAdjustment;

      reasons.push(
        `حدث مرتفع التأثير يدعم اتجاه الصفقة وأضاف ${alignedAdjustment}% حسب موثوقية المصدر`
      );
    } else {
      const breakingNeutral = highImpact.filter(
        (signal) =>
          includesContentType(
            signal,
            'BREAKING'
          ) &&
          (
            signal.sentiment === 'neutral' ||
            !signal.sentiment
          )
      );

      if (breakingNeutral.length > 0) {
        confidenceAdjustment -= 5;

        warnings.push(
          'يوجد خبر عاجل مرتفع التأثير دون اتجاه مؤكد'
        );
      }
    }
  }

  const marketBullishCount = activeMarketSignals.filter(
    (signal) =>
      signal.sentiment === 'bullish'
  ).length;

  const marketBearishCount = activeMarketSignals.filter(
    (signal) =>
      signal.sentiment === 'bearish'
  ).length;

  const marketNetDirection =
    marketBullishCount > marketBearishCount
      ? 'bullish'
      : marketBearishCount > marketBullishCount
        ? 'bearish'
        : 'neutral';

  if (
    !forcedWait &&
    activeMarketSignals.length > 0 &&
    marketNetDirection !== 'neutral'
  ) {
    if (marketNetDirection === tradeDirection) {
      confidenceAdjustment += 2;
      reasons.push(
        'الأخبار العامة للسوق تدعم اتجاه الصفقة'
      );
    } else {
      confidenceAdjustment -= 3;
      conflict = true;
      warnings.push(
        'اتجاه الأخبار العامة للسوق يعاكس اتجاه الصفقة'
      );
    }
  }

  confidenceAdjustment = Math.max(
    -15,
    Math.min(7, confidenceAdjustment)
  );

  const adjustedConfidence = Math.max(
    0,
    Math.min(
      100,
      report.confidence +
        confidenceAdjustment
    )
  );

  const adjustedDecision =
    forcedWait &&
    report.decision !==
      'REJECT_CONTRACT'
      ? 'WAIT'
      : report.decision;

  const adjustedWarnings = [
    ...report.warnings,
    ...warnings,
  ];

  const adjustedReasons = [
    ...report.reasons,
    ...reasons,
  ];

  const context: SocialDecisionContext = {
    symbol: report.symbol,
    totalSignals: signals.length,
    symbolSignalsCount: activeSymbolSignals.length,
    marketSignalsCount: activeMarketSignals.length,
    expiredSignalsCount,
    highImpactCount: highImpact.length,
    pendingHighImpactCount:
      pendingHighImpact.length,
    bullishCount: bullish.length,
    bearishCount: bearish.length,
    neutralCount: neutral.length,
    confidenceAdjustment,
    forcedWait,
    conflict,
    reasons,
    warnings,
    events: signals,
    reliability: getReliabilitySummary(signals),
  };

  const adjustedReport: TradeEngineReport = {
    ...report,
    confidence: adjustedConfidence,
    decision: adjustedDecision,
    reasons: adjustedReasons,
    warnings: adjustedWarnings,
    summary: report.summary,
  };

  adjustedReport.summary =
    updateSummary(
      adjustedReport,
      context
    );

  return {
    ...adjustedReport,
    socialIntelligence: context,
  };
}