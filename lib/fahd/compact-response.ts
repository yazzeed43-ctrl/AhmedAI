import type { TradeEngineInput } from '@/lib/trading/trade-engine';
import type { SociallyAdjustedTradeReport } from '@/lib/social/social-decision-context';

export type FahdCompactResponse = {
  symbol: string;
  decision: 'CALL' | 'PUT' | 'WAIT';
  confidence: number;
  reasons: string[];
  technicalBias: string;
  socialBias: string;
  conflict: boolean;
  criticalLevels: string[];
  nextAction: string;
};

type CollectedToolResult = {
  name: string;
  input: unknown;
  output: unknown;
};

type StockBias = 'CALL_BIAS' | 'PUT_BIAS' | 'WAIT';

type StockDecisionOutput = {
  symbol: string;
  confidence: number;
  bias: StockBias;
  decision: string;
  probabilities: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  reasons: {
    bullish: string[];
    bearish: string[];
    risks: string[];
  };
  levels: {
    val: number | null;
    poc: number | null;
    vah: number | null;
    support: number | null;
    resistance: number | null;
  };
  trigger: string[];
  invalidation: string[];
  targets: number[];
  marketContext?: {
    marketScore?: number | null;
    marketBias?: string | null;
    marketDecision?: string | null;
  };
};

type SocialSummaryOutput = {
  total: number;
  bullish: number;
  bearish: number;
  neutral: number;
  highImpactCount: number;
  earningsCount: number;
  breakingCount: number;
  weightedScore: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
};

const DETAILED_MODE_PHRASES = [
  'طھط­ظ„ظٹظ„ ظƒط§ظ…ظ„',
  'طھط­ظ„ظٹظ„ ظ…ظپطµظ„',
  'طھظ‚ط±ظٹط± ظƒط§ظ…ظ„',
  'ط¨ط§ظ„طھظپطµظٹظ„',
];

export function isDetailedRequestMode(userMessage: string): boolean {
  const normalized = userMessage.trim();

  return DETAILED_MODE_PHRASES.some((phrase) =>
    normalized.includes(phrase)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string')
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function findLatestToolResult(
  results: CollectedToolResult[],
  name: string
): CollectedToolResult | undefined {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index].name === name) {
      return results[index];
    }
  }

  return undefined;
}

function isTradeDecision(
  value: unknown
): value is SociallyAdjustedTradeReport['decision'] {
  return (
    value === 'BUY_CALL' ||
    value === 'BUY_PUT' ||
    value === 'WATCH' ||
    value === 'WAIT' ||
    value === 'REJECT_CONTRACT'
  );
}

function isDirection(
  value: unknown
): value is 'CALL' | 'PUT' | 'NEUTRAL' {
  return value === 'CALL' || value === 'PUT' || value === 'NEUTRAL';
}

function isTrigger(
  value: unknown
): value is SociallyAdjustedTradeReport['trigger'] {
  return (
    value === 'CONFIRMED' ||
    value === 'WAITING' ||
    value === 'FAILED'
  );
}

function isSocialContext(
  value: unknown
): value is SociallyAdjustedTradeReport['socialIntelligence'] {
  if (!isRecord(value)) return false;

  return (
    isFiniteNumber(value.totalSignals) &&
    isFiniteNumber(value.highImpactCount) &&
    isFiniteNumber(value.pendingHighImpactCount) &&
    isFiniteNumber(value.bullishCount) &&
    isFiniteNumber(value.bearishCount) &&
    isFiniteNumber(value.neutralCount) &&
    isFiniteNumber(value.confidenceAdjustment) &&
    typeof value.forcedWait === 'boolean' &&
    typeof value.conflict === 'boolean' &&
    isStringArray(value.reasons) &&
    isStringArray(value.warnings)
  );
}

function isSociallyAdjustedTradeReport(
  value: unknown
): value is SociallyAdjustedTradeReport {
  if (!isRecord(value)) return false;
  if (typeof value.symbol !== 'string') return false;
  if (!isTradeDecision(value.decision)) return false;
  if (!isFiniteNumber(value.confidence)) return false;
  if (!isStringArray(value.reasons)) return false;
  if (!isStringArray(value.warnings)) return false;
  if (!isTrigger(value.trigger)) return false;
  if (typeof value.alignment !== 'boolean') return false;
  if (!isRecord(value.directions)) return false;
  if (!isDirection(value.directions.market)) return false;
  if (!isDirection(value.directions.stock)) return false;

  return isSocialContext(value.socialIntelligence);
}

function extractTradeEngineInput(
  value: unknown
): TradeEngineInput | undefined {
  if (!isRecord(value) || !isRecord(value.stock)) {
    return undefined;
  }

  return value as unknown as TradeEngineInput;
}

function isStockBias(value: unknown): value is StockBias {
  return (
    value === 'CALL_BIAS' ||
    value === 'PUT_BIAS' ||
    value === 'WAIT'
  );
}

function isStockDecisionOutput(
  value: unknown
): value is StockDecisionOutput {
  if (!isRecord(value)) return false;
  if (typeof value.symbol !== 'string') return false;
  if (!isFiniteNumber(value.confidence)) return false;
  if (!isStockBias(value.bias)) return false;
  if (typeof value.decision !== 'string') return false;

  if (!isRecord(value.probabilities)) return false;
  if (!isFiniteNumber(value.probabilities.bullish)) return false;
  if (!isFiniteNumber(value.probabilities.bearish)) return false;
  if (!isFiniteNumber(value.probabilities.neutral)) return false;

  if (!isRecord(value.reasons)) return false;
  if (!isStringArray(value.reasons.bullish)) return false;
  if (!isStringArray(value.reasons.bearish)) return false;
  if (!isStringArray(value.reasons.risks)) return false;

  if (!isRecord(value.levels)) return false;
  if (!isStringArray(value.trigger)) return false;
  if (!isStringArray(value.invalidation)) return false;
  if (!Array.isArray(value.targets)) return false;

  return true;
}

function isSocialSummaryOutput(
  value: unknown
): value is SocialSummaryOutput {
  if (!isRecord(value)) return false;

  return (
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.bullish) &&
    isFiniteNumber(value.bearish) &&
    isFiniteNumber(value.neutral) &&
    isFiniteNumber(value.highImpactCount) &&
    isFiniteNumber(value.earningsCount) &&
    isFiniteNumber(value.breakingCount) &&
    isFiniteNumber(value.weightedScore) &&
    (
      value.bias === 'BULLISH' ||
      value.bias === 'BEARISH' ||
      value.bias === 'NEUTRAL'
    )
  );
}

const TRADE_DECISION_TO_COMPACT: Record<
  SociallyAdjustedTradeReport['decision'],
  FahdCompactResponse['decision']
> = {
  BUY_CALL: 'CALL',
  BUY_PUT: 'PUT',
  WATCH: 'WAIT',
  WAIT: 'WAIT',
  REJECT_CONTRACT: 'WAIT',
};

const DIRECTION_LABELS = {
  CALL: 'طµط§ط¹ط¯',
  PUT: 'ظ‡ط§ط¨ط·',
  NEUTRAL: 'ظ…ط­ط§ظٹط¯',
} as const;

function uniqueFiniteLevels(
  candidates: Array<{
    label: string;
    value: unknown;
  }>
): string[] {
  const seen = new Set<number>();
  const levels: string[] = [];

  for (const candidate of candidates) {
    if (!isFiniteNumber(candidate.value)) continue;
    if (seen.has(candidate.value)) continue;

    seen.add(candidate.value);
    levels.push(`${candidate.label} ${candidate.value}`);
  }

  return levels.slice(0, 3);
}

function buildTradeCriticalLevels(
  input: TradeEngineInput | undefined
): string[] {
  const stock = input?.stock;

  if (!stock) return [];

  return uniqueFiniteLevels([
    { label: 'VAL', value: stock.val },
    { label: 'POC', value: stock.poc },
    { label: 'VAH', value: stock.vah },
    { label: 'ط¯ط¹ظ…', value: stock.support },
    { label: 'ظ…ظ‚ط§ظˆظ…ط©', value: stock.resistance },
  ]);
}

function buildTradeSocialBias(
  context: SociallyAdjustedTradeReport['socialIntelligence']
): string {
  if (context.totalSignals === 0) {
    return 'ظ„ط§ طھظˆط¬ط¯ ط¥ط´ط§ط±ط§طھ ط§ط¬طھظ…ط§ط¹ظٹط© ط­ط¯ظٹط«ط©';
  }

  const maxCount = Math.max(
    context.bullishCount,
    context.bearishCount,
    context.neutralCount
  );

  const dominant =
    context.neutralCount === maxCount ||
    context.bullishCount === context.bearishCount
      ? 'ظ…ط­ط§ظٹط¯'
      : context.bullishCount === maxCount
        ? 'ط¥ظٹط¬ط§ط¨ظٹ'
        : 'ط³ظ„ط¨ظٹ';

  return `${dominant} (${context.bullishCount} طµط§ط¹ط¯ / ${context.bearishCount} ظ‡ط§ط¨ط· / ${context.neutralCount} ظ…ط­ط§ظٹط¯)`;
}

function buildTradeNextAction(
  report: SociallyAdjustedTradeReport
): string {
  const social = report.socialIntelligence;

  if (social.forcedWait) {
    return social.pendingHighImpactCount > 0
      ? 'ط§ظ†طھط¸ط± ط§طھط¶ط§ط­ ظ†طھظٹط¬ط© ط§ظ„ط­ط¯ط« ظ…ط±طھظپط¹ ط§ظ„طھط£ط«ظٹط± ط«ظ… ط£ط¹ط¯ ط§ظ„طھط­ظ„ظٹظ„'
      : 'ظ„ط§ طھط¯ط®ظ„ ط§ظ„ط¢ظ† ط¨ط³ط¨ط¨ طھط¹ط§ط±ط¶ ط§ظ„ط­ط¯ط« ظ…ط±طھظپط¹ ط§ظ„طھط£ط«ظٹط± ظ…ط¹ ط§طھط¬ط§ظ‡ ط§ظ„طµظپظ‚ط©';
  }

  if (report.decision === 'REJECT_CONTRACT') {
    return 'ظ„ط§ طھط¯ط®ظ„ â€” ط§ظ„ط¹ظ‚ط¯ ظ…ط±ظپظˆط¶ ط­ط³ط¨ ظ…ط¹ط§ظٹظٹط± ط§ظ„ط¬ظˆط¯ط© ظˆط§ظ„ط³ظٹظˆظ„ط©';
  }

  if (report.trigger === 'FAILED') {
    return 'ط§ظ„طھظپط¹ظٹظ„ ظپط´ظ„ â€” ظ„ط§ طھط¯ط®ظ„ ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط¥ط¹ط¯ط§ط¯ ط­ط§ظ„ظٹظ‹ط§';
  }

  if (report.trigger === 'WAITING') {
    return 'ط§ظ†طھط¸ط± طھط£ظƒظٹط¯ ط§ظ„ط´ظ…ط¹ط© ظ‚ط¨ظ„ ط§ظ„ط¯ط®ظˆظ„';
  }

  if (
    report.decision === 'BUY_CALL' ||
    report.decision === 'BUY_PUT'
  ) {
    return 'ط§ظ„طھظپط¹ظٹظ„ ظ…ط¤ظƒط¯ â€” ط§ظ„طھط²ظ… ط¨ط¥ط¯ط§ط±ط© ط§ظ„ظ…ط®ط§ط·ط± ط§ظ„ظ…ط­ط¯ط¯ط©';
  }

  return 'ط±ط§ظ‚ط¨ ط§ظ„ط³ظ‡ظ… ظˆط§ظ†طھط¸ط± طھط£ظƒظٹط¯ظ‹ط§ ط£ظˆط¶ط­';
}

function mapAnalyzeTrade(
  report: SociallyAdjustedTradeReport,
  rawInput: unknown
): FahdCompactResponse {
  const input = extractTradeEngineInput(rawInput);

  return {
    symbol: report.symbol,
    decision: TRADE_DECISION_TO_COMPACT[report.decision],
    confidence: Math.round(report.confidence),
    reasons:
      report.reasons.length > 0
        ? report.reasons.slice(0, 4)
        : ['ظ„ط§ طھطھظˆظپط± ط£ط³ط¨ط§ط¨ ظ…ظپطµظ„ط© ظ…ظ† ظ…ط­ط±ظƒ ط§ظ„طµظپظ‚ط©'],
    technicalBias:
      `ط§ظ„ط³ظ‡ظ… ${DIRECTION_LABELS[report.directions.stock]} ` +
      `ظˆط§ظ„ط³ظˆظ‚ ${DIRECTION_LABELS[report.directions.market]}`,
    socialBias: buildTradeSocialBias(report.socialIntelligence),
    conflict: report.socialIntelligence.conflict,
    criticalLevels: buildTradeCriticalLevels(input),
    nextAction: buildTradeNextAction(report),
  };
}

function stockReasons(stock: StockDecisionOutput): string[] {
  const directional =
    stock.bias === 'CALL_BIAS'
      ? stock.reasons.bullish
      : stock.bias === 'PUT_BIAS'
        ? stock.reasons.bearish
        : [
            ...stock.reasons.bullish,
            ...stock.reasons.bearish,
          ];

  const reasons = [
    ...directional,
    ...stock.reasons.risks,
  ];

  return reasons.length > 0
    ? [...new Set(reasons)].slice(0, 4)
    : ['ظ„ط§ ظٹظˆط¬ط¯ Trigger ظ…ط¤ظƒط¯ ظ„ظ„ط¯ط®ظˆظ„ ط­ط§ظ„ظٹظ‹ط§'];
}

function stockTechnicalBias(stock: StockDecisionOutput): string {
  const label =
    stock.bias === 'CALL_BIAS'
      ? 'طµط§ط¹ط¯'
      : stock.bias === 'PUT_BIAS'
        ? 'ظ‡ط§ط¨ط·'
        : 'ظ…ط­ط§ظٹط¯';

  const marketBias = stock.marketContext?.marketBias;

  return marketBias
    ? `ط§ظ„ط³ظ‡ظ… ${label} ظˆط§ظ„ط³ظˆظ‚ ${marketBias}`
    : `ط§ظ„ط³ظ‡ظ… ${label}`;
}

function stockCriticalLevels(stock: StockDecisionOutput): string[] {
  return uniqueFiniteLevels([
    { label: 'VAL', value: stock.levels.val },
    { label: 'POC', value: stock.levels.poc },
    { label: 'VAH', value: stock.levels.vah },
    { label: 'ط¯ط¹ظ…', value: stock.levels.support },
    { label: 'ظ…ظ‚ط§ظˆظ…ط©', value: stock.levels.resistance },
  ]);
}

function socialBiasLabel(
  social: SocialSummaryOutput | undefined
): string {
  if (!social || social.total === 0) {
    return 'ظ„ط§ طھظˆط¬ط¯ ط¥ط´ط§ط±ط§طھ ط§ط¬طھظ…ط§ط¹ظٹط© ط­ط¯ظٹط«ط©';
  }

  const label =
    social.bias === 'BULLISH'
      ? 'ط¥ظٹط¬ط§ط¨ظٹ'
      : social.bias === 'BEARISH'
        ? 'ط³ظ„ط¨ظٹ'
        : 'ظ…ط­ط§ظٹط¯';

  return `${label} (${social.bullish} طµط§ط¹ط¯ / ${social.bearish} ظ‡ط§ط¨ط· / ${social.neutral} ظ…ط­ط§ظٹط¯)`;
}

function hasStockSocialConflict(
  stock: StockDecisionOutput,
  social: SocialSummaryOutput | undefined
): boolean {
  if (!social) return false;

  return (
    (stock.bias === 'CALL_BIAS' && social.bias === 'BEARISH') ||
    (stock.bias === 'PUT_BIAS' && social.bias === 'BULLISH')
  );
}

function mapStockDecision(
  stock: StockDecisionOutput,
  social: SocialSummaryOutput | undefined
): FahdCompactResponse {
  const conflict = hasStockSocialConflict(stock, social);
  const highImpact = (social?.highImpactCount ?? 0) > 0;

  const socialReason = highImpact
    ? 'طھظˆط¬ط¯ ط¥ط´ط§ط±ط© ط§ط¬طھظ…ط§ط¹ظٹط© ظ…ط±طھظپط¹ط© ط§ظ„طھط£ط«ظٹط± ظˆطھط­طھط§ط¬ طھط£ظƒظٹط¯ظ‹ط§ ظ‚ط¨ظ„ ط§ظ„ط¯ط®ظˆظ„'
    : null;

  const reasons = stockReasons(stock);

  if (socialReason && reasons.length < 4) {
    reasons.push(socialReason);
  }

  const nextAction =
    highImpact
      ? 'ط§ظ†طھط¸ط± طھط£ظƒظٹط¯ ط§ظ„ط­ط¯ط« ظˆTrigger ط§ظ„ط³ظ‡ظ… ظ‚ط¨ظ„ ط£ظٹ ط¯ط®ظˆظ„'
      : stock.trigger[0] ??
        'ط§ظ†طھط¸ط± Trigger ظپظ†ظٹ ظˆط§ط¶ط­ ظ‚ط¨ظ„ ط§ظ„ط¯ط®ظˆظ„';

  return {
    symbol: stock.symbol,
    // get_stock_decision ظٹط¹ظٹط¯ ط§ظ†ط­ظٹط§ط²ظ‹ط§ ظپظ‚ط· ظˆظٹط´طھط±ط· Triggerط› ظ„ط°ظ„ظƒ ط§ظ„ظ‚ط±ط§ط± ط§ظ„طھظ†ظپظٹط°ظٹ WAIT.
    decision: 'WAIT',
    confidence: Math.round(stock.confidence),
    reasons: reasons.slice(0, 4),
    technicalBias: stockTechnicalBias(stock),
    socialBias: socialBiasLabel(social),
    conflict,
    criticalLevels: stockCriticalLevels(stock),
    nextAction,
  };
}

export function extractCompactResponse(
  collectedToolResults: CollectedToolResult[]
): FahdCompactResponse | null {
  const tradeResult = findLatestToolResult(
    collectedToolResults,
    'analyze_trade'
  );

  if (
    tradeResult &&
    isSociallyAdjustedTradeReport(tradeResult.output)
  ) {
    return mapAnalyzeTrade(
      tradeResult.output,
      tradeResult.input
    );
  }

  const stockResult = findLatestToolResult(
    collectedToolResults,
    'get_stock_decision'
  );

  if (
    stockResult &&
    isStockDecisionOutput(stockResult.output)
  ) {
    const socialResult = findLatestToolResult(
      collectedToolResults,
      'get_recent_social_signals'
    );

    const social =
      socialResult &&
      isSocialSummaryOutput(socialResult.output)
        ? socialResult.output
        : undefined;

    return mapStockDecision(stockResult.output, social);
  }

  return null;
}

const MAX_COMPACT_WORDS = 180;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function enforceWordLimit(
  text: string,
  maxWords: number
): string {
  if (countWords(text) <= maxWords) return text;

  const words = text.trim().split(/\s+/).filter(Boolean);

  return `${words.slice(0, maxWords).join(' ')}â€¦`;
}

export function formatCompactResponse(
  data: FahdCompactResponse
): string {
  const reasons = data.reasons
    .slice(0, 4)
    .map((reason) => `- ${reason}`)
    .join('\n');

  const levels =
    data.criticalLevels.length > 0
      ? data.criticalLevels.join(' / ')
      : 'ط؛ظٹط± ظ…ط­ط¯ط¯';

  const response = [
    `ًںڑ¦ ${data.symbol} â€” ط§ظ„ظ‚ط±ط§ط± ط§ظ„ظ†ظ‡ط§ط¦ظٹ`,
    '',
    `ط§ظ„ظ‚ط±ط§ط±: ${data.decision}`,
    `ط§ظ„ط«ظ‚ط© ط§ظ„ظ†ظ‡ط§ط¦ظٹط©: ${data.confidence}%`,
    '',
    'ط§ظ„ط£ط³ط¨ط§ط¨:',
    reasons,
    '',
    `ط§ظ„ط§ظ†ط­ظٹط§ط² ط§ظ„ظپظ†ظٹ: ${data.technicalBias}`,
    `ط§ظ„ط§ظ†ط­ظٹط§ط² ط§ظ„ط§ط¬طھظ…ط§ط¹ظٹ: ${data.socialBias}`,
    `ط§ظ„طھط¹ط§ط±ط¶: ${data.conflict ? 'ظ†ط¹ظ…' : 'ظ„ط§'}`,
    `ط§ظ„ظ…ط³طھظˆظ‰ ط§ظ„ط­ط§ط³ظ…: ${levels}`,
    `ط§ظ„ط®ط·ط©: ${data.nextAction}`,
  ].join('\n');

  return enforceWordLimit(
    response,
    MAX_COMPACT_WORDS
  );
}

export function buildFahdResponse(params: {
  userMessage: string;
  assistantText: string;
  collectedToolResults: CollectedToolResult[];
}): string {
  const {
    userMessage,
    assistantText,
    collectedToolResults,
  } = params;

  if (isDetailedRequestMode(userMessage)) {
    return assistantText;
  }

  const compact = extractCompactResponse(
    collectedToolResults
  );

  if (!compact) {
    // ط§ظ„ط·ظ„ط¨ط§طھ ط؛ظٹط± ط§ظ„طھط­ظ„ظٹظ„ظٹط© طھط¨ظ‚ظ‰ ط¨ط±ط¯ Claude ط§ظ„ط·ط¨ظٹط¹ظٹ ط¨ط¯ظ„ ط±ط³ط§ظ„ط© ظپط´ظ„ ظ…ط²ط¹ط¬ط©.
    return assistantText;
  }

  return formatCompactResponse(compact);
}
