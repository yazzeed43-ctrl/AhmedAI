import type { TradeEngineInput } from '../trading/trade-engine';
import type { SociallyAdjustedTradeReport } from '../social/social-decision-context';

export type FahdCompactResponse = {
  symbol: string;
  decision: 'CALL' | 'PUT' | 'WAIT';
  confidence: number;
  confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  technicalBias: string;
  socialBias: string;
  // true فقط لو الطريق الكامل (analyze_trade → runTradeEngine →
  // applySocialIntelligenceToTradeReport) هو اللي أنتج هذا الرد.
  // مسار get_stock_decision + get_recent_social_signals يعرض إشارات
  // اجتماعية خام كسياق فقط، ولا يوزّنها في الثقة النهائية إطلاقًا —
  // هذا الحقل يمنع الالتباس بين "ظهور انحياز اجتماعي" و"تأثيره الفعلي".
  socialWeightingApplied: boolean;
  conflict: boolean;
  criticalLevels: string[];
  nextAction: string;
  executionReadiness: string[];
};

type CollectedToolResult = {
  name: string;
  input: unknown;
  output: unknown;
};

type MarketDecisionOutput = {
  underlying: string;
  timeframe: string;
  marketScore: number;
  confidence: number;
  probabilities: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  bias: 'CALL_BIAS' | 'PUT_BIAS' | 'WAIT';
  decision: string;
  dataReadyForEntry: boolean;
  blockingReasons: string[];
  conditions?: {
    call?: string[];
    put?: string[];
  };
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

function isMarketDecisionOutput(value: unknown): value is MarketDecisionOutput {
  if (!isRecord(value)) return false;
  if (typeof value.underlying !== 'string') return false;
  if (typeof value.timeframe !== 'string') return false;
  if (!isFiniteNumber(value.marketScore)) return false;
  if (!isFiniteNumber(value.confidence)) return false;
  if (value.bias !== 'CALL_BIAS' && value.bias !== 'PUT_BIAS' && value.bias !== 'WAIT') return false;
  if (typeof value.decision !== 'string') return false;
  if (typeof value.dataReadyForEntry !== 'boolean') return false;
  if (!isStringArray(value.blockingReasons)) return false;
  if (!isRecord(value.probabilities)) return false;

  return (
    isFiniteNumber(value.probabilities.bullish) &&
    isFiniteNumber(value.probabilities.bearish) &&
    isFiniteNumber(value.probabilities.neutral)
  );
}

function formatMarketDecisionFallback(output: MarketDecisionOutput): string {
  const direction =
    output.bias === 'CALL_BIAS'
      ? 'CALL_BIAS'
      : output.bias === 'PUT_BIAS'
        ? 'PUT_BIAS'
        : 'محايد';
  const blockers = output.blockingReasons.length > 0
    ? output.blockingReasons.slice(0, 6).map((reason) => `- ${reason}`)
    : ['- لا يوجد Trigger تنفيذي مؤكد حتى الآن.'];
  const directionalConditions =
    output.bias === 'CALL_BIAS'
      ? output.conditions?.call
      : output.bias === 'PUT_BIAS'
        ? output.conditions?.put
        : undefined;
  const triggerLines = directionalConditions?.length
    ? directionalConditions.slice(0, 5).map((condition) => `- ${condition}`)
    : ['- لم يُحسم Trigger تنفيذي دقيق حاليًا.'];

  return [
    `تحليل ${output.underlying} — ${output.timeframe}`,
    '',
    `القرار: ${output.decision}`,
    `الانحياز: ${direction}`,
    `درجة السوق: ${Math.round(output.marketScore)}/100`,
    `الثقة في البيانات: ${Math.round(output.confidence)}%`,
    `الاحتمالات: CALL ${Math.round(output.probabilities.bullish)}% | PUT ${Math.round(output.probabilities.bearish)}% | محايد ${Math.round(output.probabilities.neutral)}%`,
    '',
    `جاهزية البيانات للدخول: ${output.dataReadyForEntry ? 'مكتملة' : 'غير مكتملة'}`,
    'أسباب الانتظار أو المنع:',
    ...blockers,
    '',
    'Trigger المطلوب:',
    ...triggerLines,
    '',
    'النتيجة التنفيذية: مراقبة فقط؛ الانحياز وحده ليس أمر دخول.',
    'isExecutable: false',
    'executableTrigger: null',
  ].join('\n');
}

/**
 * Last-resort response built directly from trusted tool output. It must never
 * replace a completed analysis with a generic "synthesis timed out" message.
 */
export function formatDeterministicToolFallback(
  collectedToolResults: CollectedToolResult[]
): string {
  const marketResult = findLatestToolResult(
    collectedToolResults,
    'get_market_decision'
  );

  if (marketResult && isMarketDecisionOutput(marketResult.output)) {
    return formatMarketDecisionFallback(marketResult.output);
  }

  const compact = extractCompactResponse(collectedToolResults);
  if (compact) return formatCompactResponse(compact);

  for (let index = collectedToolResults.length - 1; index >= 0; index -= 1) {
    const result = collectedToolResults[index];
    if (!isRecord(result.output)) continue;

    const explicitMessage = result.output.userMessage ?? result.output.message ?? result.output.reason;
    if (typeof explicitMessage === 'string' && explicitMessage.trim()) {
      return [
        explicitMessage.trim(),
        '',
        'النتيجة التنفيذية: لا يُعد هذا المسار أمر دخول دون Trigger مؤكد.',
        'isExecutable: false',
        'executableTrigger: null',
      ].join('\n');
    }
  }

  return [
    'اكتملت أدوات فهد، لكن النتيجة المتاحة لا تحتوي حقولًا كافية لبناء تحليل موثوق.',
    'القرار: WAIT_DATA',
    'isExecutable: false',
    'executableTrigger: null',
  ].join('\n');
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
    confidenceLabel: confidenceLabel(report.confidence),
    reasons:
      report.reasons.length > 0
        ? report.reasons.slice(0, 4)
        : ['لا تتوفر أسباب مفصلة من محرك الصفقة'],
    technicalBias:
      `السهم ${DIRECTION_LABELS[report.directions.stock]} ` +
      `والسوق ${DIRECTION_LABELS[report.directions.market]}`,
    socialBias: buildTradeSocialBias(report.socialIntelligence),
    socialWeightingApplied: true,
    conflict: report.socialIntelligence.conflict,
    criticalLevels: buildTradeCriticalLevels(input),
    nextAction: buildTradeNextAction(report),
    executionReadiness: buildExecutionReadiness(
      TRADE_DECISION_TO_COMPACT[report.decision]
    ),
  };
}

function confidenceLabel(
  confidence: number
): FahdCompactResponse['confidenceLabel'] {
  if (confidence < 55) return 'LOW';
  if (confidence < 75) return 'MEDIUM';
  return 'HIGH';
}

function buildExecutionReadiness(
  decision: FahdCompactResponse['decision']
): string[] {
  if (decision !== 'WAIT') {
    return [
      'القرار التنفيذي اجتاز بوابات المحرك الحالية',
      'التزم بالتفعيل والإبطال وإدارة المخاطر المحددة',
    ];
  }

  return [
    'لا يوجد Trigger تنفيذي مؤكد',
    'لا يوجد تأكيد لآخر شمعة 5 دقائق مغلقة',
    'يجب إعادة التحقق من السعر الحي والسوق والأخبار والتقويم',
  ];
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

function hasStockMarketConflict(
  stock: StockDecisionOutput
): boolean {
  const marketBias = stock.marketContext?.marketBias;

  if (stock.bias === 'CALL_BIAS') {
    return marketBias === 'PUT_BIAS';
  }

  if (stock.bias === 'PUT_BIAS') {
    return marketBias === 'CALL_BIAS';
  }

  const primaryPlan = stock.trigger[0]?.toUpperCase() ?? '';

  return (
    (primaryPlan.includes('CALL') && marketBias === 'PUT_BIAS') ||
    (primaryPlan.includes('PUT') && marketBias === 'CALL_BIAS')
  );
}

function mapStockDecision(
  stock: StockDecisionOutput,
  social: SocialSummaryOutput | undefined
): FahdCompactResponse {
  const conflict =
    hasStockSocialConflict(stock, social) ||
    hasStockMarketConflict(stock);
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
    decision: 'WAIT',
    confidence: Math.round(stock.confidence),
    confidenceLabel: confidenceLabel(stock.confidence),
    reasons: reasons.slice(0, 4),
    technicalBias: stockTechnicalBias(stock),
    socialBias: socialBiasLabel(social),
    socialWeightingApplied: false,
    conflict,
    criticalLevels: stockCriticalLevels(stock),
    nextAction,
    executionReadiness: buildExecutionReadiness('WAIT'),
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

  const readiness = data.executionReadiness
    .map((item) => `□ ${item}`)
    .join('\n');

  const isWaiting = data.decision === 'WAIT';

  const response = [
    `🚦 ${data.symbol} — القرار النهائي`,
    '',
    `القرار: ${data.decision}`,
    `الثقة النهائية: ${data.confidenceLabel} — ${data.confidence}%`,
    isWaiting
      ? 'الملخص التنفيذي: لا يوجد سبب إحصائي لفتح صفقة الآن؛ للمراقبة فقط.'
      : 'الملخص التنفيذي: القرار اجتاز شروط المحرك الحالية.',
    '',
    'الأسباب:',
    reasons,
    '',
    `الانحياز الفني: ${data.technicalBias}`,
    `الانحياز الاجتماعي: ${data.socialBias}`,
    `Social V3: ${
      data.socialWeightingApplied
        ? 'مُطبّق — الثقة معدّلة بموثوقية المصدر'
        : 'لم يُطبّق لأن تحليل الصفقة الكامل (analyze_trade) لم يُشغّل'
    }`,
    `التعارض: ${data.conflict ? 'نعم' : 'لا'}`,
    `${isWaiting ? 'مستويات المراقبة المرجعية' : 'المستوى الحاسم'}: ${levels}`,
    `${isWaiting ? 'خطة المراقبة' : 'الخطة'}: ${data.nextAction}`,
    '',
    `جاهزية التنفيذ: ${isWaiting ? 'WAIT' : 'READY'}`,
    readiness,
    ...(isWaiting
      ? [
          'isExecutable: false',
          'executableTrigger: null',
        ]
      : []),
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
    return assistantText;
  }

  return formatCompactResponse(compact);
}
