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
    BUY_CALL: 'ط·آ·ط¢آ´ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ·ط·إ’ ط·آ·ط¢آ¹ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ¯ ط·آ¸ط¦â€™ط·آ¸ط«â€ ط·آ¸أ¢â‚¬â€چ',
    BUY_PUT: 'ط·آ·ط¢آ´ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ·ط·إ’ ط·آ·ط¢آ¹ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ¯ ط·آ·ط¢آ¨ط·آ¸ط«â€ ط·آ·ط¹آ¾',
    WATCH: 'ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ¨ط·آ·ط¢آ© ط·آ¸ط«â€ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ ط·آ·ط¹آ¾ط·آ·ط¢آ¸ط·آ·ط¢آ§ط·آ·ط¢آ± ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ¸ط¦â€™ط·آ¸ط¸آ¹ط·آ·ط¢آ¯',
    WAIT: 'ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ ط·آ·ط¹آ¾ط·آ·ط¢آ¸ط·آ·ط¢آ§ط·آ·ط¢آ± ط·آ¸ط«â€ ط·آ·ط¢آ¹ط·آ·ط¢آ¯ط·آ¸أ¢â‚¬آ¦ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¯ط·آ·ط¢آ®ط·آ¸ط«â€ ط·آ¸أ¢â‚¬â€چ',
    REJECT_CONTRACT: 'ط·آ·ط¢آ±ط·آ¸ط¸آ¾ط·آ·ط¢آ¶ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¹ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ¯',
  };

  return labels[decision];
}

function updateSummary(
  report: TradeEngineReport,
  context: SocialDecisionContext
): string {
  let summary = report.summary;

  summary = summary.replace(
    /^ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ·ط¢آ±:.*$/m,
    `ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ·ط¢آ±: ${getDirectionLabel(report.decision)}`
  );

  summary = summary.replace(
    /^ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ«ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ©:.*$/m,
    `ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ«ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ©: ${report.confidence}%`
  );

  const socialLines = [
    '',
    'ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ°ط·آ¸ط¦â€™ط·آ·ط¢آ§ط·آ·ط·إ’ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ§ط·آ·ط¢آ¬ط·آ·ط¹آ¾ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ§ط·آ·ط¢آ¹ط·آ¸ط¸آ¹:',
    `ط·آ·ط¢آ¹ط·آ·ط¢آ¯ط·آ·ط¢آ¯ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ£ط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ§ط·آ·ط¢آ« ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ¸ط¸آ¹ط·آ·ط¢آ«ط·آ·ط¢آ©: ${context.totalSignals}`,
    `ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ£ط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ§ط·آ·ط¢آ« ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¹آ¾ط·آ¸ط¸آ¾ط·آ·ط¢آ¹ط·آ·ط¢آ© ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ±: ${context.highImpactCount}`,
    `ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ£ط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ§ط·آ·ط¢آ« ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ¹ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ© ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¹آ¾ط·آ¸ط¸آ¾ط·آ·ط¢آ¹ط·آ·ط¢آ© ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ±: ${context.pendingHighImpactCount}`,
    `ط·آ·ط¹آ¾ط·آ·ط¢آ¹ط·آ·ط¢آ¯ط·آ¸ط¸آ¹ط·آ¸أ¢â‚¬â€چ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ«ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ©: ${
      context.confidenceAdjustment >= 0 ? '+' : ''
    }${context.confidenceAdjustment}%`,
  ];

  if (context.reasons.length > 0) {
    socialLines.push(
      `ط·آ·ط¢آ£ط·آ·ط¢آ³ط·آ·ط¢آ¨ط·آ·ط¢آ§ط·آ·ط¢آ¨ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ±: ${context.reasons.join('ط·آ·ط¥â€™ ')}`
    );
  }

  if (context.warnings.length > 0) {
    socialLines.push(
      `ط·آ·ط¹آ¾ط·آ·ط¢آ­ط·آ·ط¢آ°ط·آ¸ط¸آ¹ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ·ط¹آ¾ ط·آ·ط¢آ§ط·آ·ط¢آ¬ط·آ·ط¹آ¾ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ§ط·آ·ط¢آ¹ط·آ¸ط¸آ¹ط·آ·ط¢آ©: ${context.warnings.join('ط·آ·ط¥â€™ ')}`
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
      `ط·آ¸ط¸آ¹ط·آ¸ط«â€ ط·آ·ط¢آ¬ط·آ·ط¢آ¯ ط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ« ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¹آ¾ط·آ¸ط¸آ¾ط·آ·ط¢آ¹ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ± ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬آ¦ ط·آ¸ط¸آ¹ط·آ·ط¢آµط·آ·ط¢آ¯ط·آ·ط¢آ± ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¢آ¬ط·آ·ط¢آ§ط·آ¸أ¢â‚¬طŒط·آ¸أ¢â‚¬طŒ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬آ ط·آ¸أ¢â‚¬طŒط·آ·ط¢آ§ط·آ·ط¢آ¦ط·آ¸ط¸آ¹${
        pendingSymbols.length > 0
          ? ` ط·آ·ط¢آ¹ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬آ° ${pendingSymbols.join(', ')}`
          : ''
      }`
    );

    reasons.push(
      'ط·آ·ط¹آ¾ط·آ¸أ¢â‚¬آ¦ ط·آ·ط¹آ¾ط·آ·ط¢آ®ط·آ¸ط¸آ¾ط·آ¸ط¸آ¹ط·آ·ط¢آ¶ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ«ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ© 10% ط·آ·ط¢آ­ط·آ·ط¹آ¾ط·آ¸أ¢â‚¬آ° ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¢آ¶ط·آ·ط¢آ§ط·آ·ط¢آ­ ط·آ¸أ¢â‚¬آ ط·آ·ط¹آ¾ط·آ¸ط¸آ¹ط·آ·ط¢آ¬ط·آ·ط¢آ© ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ« ط·آ·ط¢آ£ط·آ¸ط«â€  ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ¸ط«â€ ط·آ·ط¢آ¬ط·آ¸ط¸آ¹ط·آ¸أ¢â‚¬طŒط·آ·ط¢آ§ط·آ·ط¹آ¾'
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
        'ط·آ¸ط¸آ¹ط·آ¸ط«â€ ط·آ·ط¢آ¬ط·آ·ط¢آ¯ ط·آ·ط¢آ®ط·آ·ط¢آ¨ط·آ·ط¢آ± ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¹آ¾ط·آ¸ط¸آ¾ط·آ·ط¢آ¹ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ± ط·آ¸ط¸آ¹ط·آ·ط¹آ¾ط·آ·ط¢آ¹ط·آ·ط¢آ§ط·آ·ط¢آ±ط·آ·ط¢آ¶ ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ¹ ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¢آ¬ط·آ·ط¢آ§ط·آ¸أ¢â‚¬طŒ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آµط·آ¸ط¸آ¾ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ©'
      );

      reasons.push(
        'ط·آ·ط¹آ¾ط·آ¸أ¢â‚¬آ¦ ط·آ·ط¹آ¾ط·آ·ط¢آ­ط·آ¸ط«â€ ط·آ¸ط¸آ¹ط·آ¸أ¢â‚¬â€چ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ±ط·آ·ط¢آ§ط·آ·ط¢آ± ط·آ·ط¢آ¥ط·آ¸أ¢â‚¬â€چط·آ¸أ¢â‚¬آ° ط·آ·ط¢آ§ط·آ¸أ¢â‚¬آ ط·آ·ط¹آ¾ط·آ·ط¢آ¸ط·آ·ط¢آ§ط·آ·ط¢آ± ط·آ·ط¢آ¨ط·آ·ط¢آ³ط·آ·ط¢آ¨ط·آ·ط¢آ¨ ط·آ·ط¹آ¾ط·آ·ط¢آ¹ط·آ·ط¢آ§ط·آ·ط¢آ±ط·آ·ط¢آ¶ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ« ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ¹ ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¢آ¬ط·آ·ط¢آ§ط·آ¸أ¢â‚¬طŒ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آ¹ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ¯'
      );
    } else if (alignedHighImpact.length > 0) {
      confidenceAdjustment += 5;

      reasons.push(
        'ط·آ·ط¢آ­ط·آ·ط¢آ¯ط·آ·ط¢آ« ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¹آ¾ط·آ¸ط¸آ¾ط·آ·ط¢آ¹ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ± ط·آ¸ط¸آ¹ط·آ·ط¢آ¯ط·آ·ط¢آ¹ط·آ¸أ¢â‚¬آ¦ ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¢آ¬ط·آ·ط¢آ§ط·آ¸أ¢â‚¬طŒ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¢آµط·آ¸ط¸آ¾ط·آ¸أ¢â‚¬ع‘ط·آ·ط¢آ©'
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
          'ط·آ¸ط¸آ¹ط·آ¸ط«â€ ط·آ·ط¢آ¬ط·آ·ط¢آ¯ ط·آ·ط¢آ®ط·آ·ط¢آ¨ط·آ·ط¢آ± ط·آ·ط¢آ¹ط·آ·ط¢آ§ط·آ·ط¢آ¬ط·آ¸أ¢â‚¬â€چ ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ±ط·آ·ط¹آ¾ط·آ¸ط¸آ¾ط·آ·ط¢آ¹ ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چط·آ·ط¹آ¾ط·آ·ط¢آ£ط·آ·ط¢آ«ط·آ¸ط¸آ¹ط·آ·ط¢آ± ط·آ·ط¢آ¯ط·آ¸ط«â€ ط·آ¸أ¢â‚¬آ  ط·آ·ط¢آ§ط·آ·ط¹آ¾ط·آ·ط¢آ¬ط·آ·ط¢آ§ط·آ¸أ¢â‚¬طŒ ط·آ¸أ¢â‚¬آ¦ط·آ·ط¢آ¤ط·آ¸ط¦â€™ط·آ·ط¢آ¯'
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
