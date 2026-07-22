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
  'تحليل كامل',
  'تحليل مفصل',
  'تقرير كامل',
  'بالتفصيل',
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
  CALL: 'صاعد',
  PUT: 'هابط',
  NEUTRAL: 'محايد',
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
    { label: 'دعم', value: stock.support },
    { label: 'مقاومة', value: stock.resistance },
  ]);
}

function buildTradeSocialBias(
  context: SociallyAdjustedTradeReport['socialIntelligence']
): string {
  if (context.totalSignals === 0) {
    return 'لا توجد إشارات اجتماعية حديثة';
  }

  const maxCount = Math.max(
    context.bullishCount,
    context.bearishCount,
    context.neutralCount
  );

  const dominant =
    context.neutralCount === maxCount ||
    context.bullishCount === context.bearishCount
      ? 'محايد'
      : context.bullishCount === maxCount
        ? 'إيجابي'
        : 'سلبي';

  return `${dominant} (${context.bullishCount} صاعد / ${context.bearishCount} هابط / ${context.neutralCount} محايد)`;
}

function buildTradeNextAction(
  report: SociallyAdjustedTradeReport
): string {
  const social = report.socialIntelligence;

  if (social.forcedWait) {
    return social.pendingHighImpactCount > 0
      ? 'انتظر اتضاح نتيجة الحدث مرتفع التأثير ثم أعد التحليل'
      : 'لا تدخل الآن بسبب تعارض الحدث مرتفع التأثير مع اتجاه الصفقة';
  }

  if (report.decision === 'REJECT_CONTRACT') {
    return 'لا تدخل — العقد مرفوض حسب معايير الجودة والسيولة';
  }

  if (report.trigger === 'FAILED') {
    return 'التفعيل فشل — لا تدخل على هذا الإعداد حاليًا';
  }

  if (report.trigger === 'WAITING') {
    return 'انتظر تأكيد الشمعة قبل الدخول';
  }

  if (
    report.decision === 'BUY_CALL' ||
    report.decision === 'BUY_PUT'
  ) {
    return 'التفعيل مؤكد — التزم بإدارة المخاطر المحددة';
  }

  return 'راقب السهم وانتظر تأكيدًا أوضح';
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
        : ['لا تتوفر أسباب مفصلة من محرك الصفقة'],
    technicalBias:
      `السهم ${DIRECTION_LABELS[report.directions.stock]} ` +
      `والسوق ${DIRECTION_LABELS[report.directions.market]}`,
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
    : ['لا يوجد Trigger مؤكد للدخول حاليًا'];
}

function stockTechnicalBias(stock: StockDecisionOutput): string {
  const label =
    stock.bias === 'CALL_BIAS'
      ? 'صاعد'
      : stock.bias === 'PUT_BIAS'
        ? 'هابط'
        : 'محايد';

  const marketBias = stock.marketContext?.marketBias;

  return marketBias
    ? `السهم ${label} والسوق ${marketBias}`
    : `السهم ${label}`;
}

function stockCriticalLevels(stock: StockDecisionOutput): string[] {
  return uniqueFiniteLevels([
    { label: 'VAL', value: stock.levels.val },
    { label: 'POC', value: stock.levels.poc },
    { label: 'VAH', value: stock.levels.vah },
    { label: 'دعم', value: stock.levels.support },
    { label: 'مقاومة', value: stock.levels.resistance },
  ]);
}

function socialBiasLabel(
  social: SocialSummaryOutput | undefined
): string {
  if (!social || social.total === 0) {
    return 'لا توجد إشارات اجتماعية حديثة';
  }

  const label =
    social.bias === 'BULLISH'
      ? 'إيجابي'
      : social.bias === 'BEARISH'
        ? 'سلبي'
        : 'محايد';

  return `${label} (${social.bullish} صاعد / ${social.bearish} هابط / ${social.neutral} محايد)`;
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
    ? 'توجد إشارة اجتماعية مرتفعة التأثير وتحتاج تأكيدًا قبل الدخول'
    : null;

  const reasons = stockReasons(stock);

  if (socialReason && reasons.length < 4) {
    reasons.push(socialReason);
  }

  const nextAction =
    highImpact
      ? 'انتظر تأكيد الحدث وTrigger السهم قبل أي دخول'
      : stock.trigger[0] ??
        'انتظر Trigger فني واضح قبل الدخول';

  return {
    symbol: stock.symbol,
    // get_stock_decision يعيد انحيازًا فقط ويشترط Trigger؛ لذلك القرار التنفيذي WAIT.
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

  return `${words.slice(0, maxWords).join(' ')}…`;
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
      : 'غير محدد';

  const response = [
    `🚦 ${data.symbol} — القرار النهائي`,
    '',
    `القرار: ${data.decision}`,
    `الثقة النهائية: ${data.confidence}%`,
    '',
    'الأسباب:',
    reasons,
    '',
    `الانحياز الفني: ${data.technicalBias}`,
    `الانحياز الاجتماعي: ${data.socialBias}`,
    `التعارض: ${data.conflict ? 'نعم' : 'لا'}`,
    `المستوى الحاسم: ${levels}`,
    `الخطة: ${data.nextAction}`,
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
    // الطلبات غير التحليلية تبقى برد Claude الطبيعي بدل رسالة فشل مزعجة.
    return assistantText;
  }

  return formatCompactResponse(compact);
}
