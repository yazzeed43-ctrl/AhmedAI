import type {
  TradeEngineReport,
} from '@/lib/trading/trade-engine';

import {
  getRecentSocialSignals,
} from '@/lib/social/social-signals';

type SocialSignal = {
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

export type SocialDecisionContext = {
  symbol: string;
  totalSignals: number;
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
    `عدد الأحداث الحديثة: ${context.totalSignals}`,
    `الأحداث مرتفعة التأثير: ${context.highImpactCount}`,
    `الأحداث المعلقة مرتفعة التأثير: ${context.pendingHighImpactCount}`,
    `تعديل الثقة: ${
      context.confidenceAdjustment >= 0 ? '+' : ''
    }${context.confidenceAdjustment}%`,
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

export async function applySocialIntelligenceToTradeReport(
  report: TradeEngineReport,
  params?: {
    minutes?: number;
    limit?: number;
  }
): Promise<SociallyAdjustedTradeReport> {
  const signals = (await getRecentSocialSignals({
    symbol: report.symbol,
    minutes: params?.minutes ?? 1440,
    limit: params?.limit ?? 50,
  })) as SocialSignal[];

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
    confidenceAdjustment -= 10;
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
      'تم تخفيض الثقة 10% حتى اتضاح نتيجة الحدث أو التوجيهات'
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
      confidenceAdjustment -= 10;
      forcedWait = true;

      warnings.push(
        'يوجد خبر مرتفع التأثير يتعارض مع اتجاه الصفقة'
      );

      reasons.push(
        'تم تحويل القرار إلى انتظار بسبب تعارض الحدث مع اتجاه العقد'
      );
    } else if (alignedHighImpact.length > 0) {
      confidenceAdjustment += 5;

      reasons.push(
        'حدث مرتفع التأثير يدعم اتجاه الصفقة'
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
