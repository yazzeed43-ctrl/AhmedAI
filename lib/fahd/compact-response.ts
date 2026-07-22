// lib/fahd/compact-response.ts
//
// طبقة إخراج ثابتة لردود فهد — لا تلمس أي محرك أو scoring.
// لا يوجد أي استدعاء LLM إضافي هنا. المصدر الوحيد للبيانات في
// الوضع المختصر هو collectedToolResults. assistantText يُستخدم
// حصريًا في الوضع المفصل، ولا يُقرأ أو يُحلَّل إطلاقًا هنا.
//
// ⚠️ يتطلب هذا الملف أن يحتوي SocialDecisionContext (في
// social-decision-context.ts) على حقل conflict: boolean.
// لن يبني المشروع قبل إضافة هذا الحقل هناك.

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

// ============================================================
// 1) كشف نية المستخدم (مختصر افتراضيًا / مفصل عند الطلب الصريح)
// ============================================================

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

// ============================================================
// 2) Type guards حقيقية لنتيجة analyze_trade (لا يوجد any)
// ============================================================

function isValidDecisionValue(
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

function isValidDirectionValue(
  value: unknown
): value is 'CALL' | 'PUT' | 'NEUTRAL' {
  return value === 'CALL' || value === 'PUT' || value === 'NEUTRAL';
}

function isValidTriggerValue(
  value: unknown
): value is SociallyAdjustedTradeReport['trigger'] {
  return value === 'CONFIRMED' || value === 'WAITING' || value === 'FAILED';
}

function isSocialDecisionContext(
  value: unknown
): value is SociallyAdjustedTradeReport['socialIntelligence'] {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;

  return (
    typeof c.totalSignals === 'number' &&
    typeof c.highImpactCount === 'number' &&
    typeof c.pendingHighImpactCount === 'number' &&
    typeof c.bullishCount === 'number' &&
    typeof c.bearishCount === 'number' &&
    typeof c.neutralCount === 'number' &&
    typeof c.confidenceAdjustment === 'number' &&
    typeof c.forcedWait === 'boolean' &&
    typeof c.conflict === 'boolean' &&
    Array.isArray(c.reasons) &&
    Array.isArray(c.warnings)
  );
}

function isSociallyAdjustedTradeReport(
  value: unknown
): value is SociallyAdjustedTradeReport {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;

  if (typeof r.symbol !== 'string') return false;
  if (!isValidDecisionValue(r.decision)) return false;
  if (typeof r.confidence !== 'number') return false;
  if (!Array.isArray(r.reasons)) return false;
  if (!Array.isArray(r.warnings)) return false;
  if (!isValidTriggerValue(r.trigger)) return false;
  if (typeof r.alignment !== 'boolean') return false;

  const directions = r.directions as Record<string, unknown> | undefined;
  if (
    typeof directions !== 'object' ||
    directions === null ||
    !isValidDirectionValue(directions.market) ||
    !isValidDirectionValue(directions.stock)
  ) {
    return false;
  }

  if (!isSocialDecisionContext(r.socialIntelligence)) return false;

  return true;
}

// حارس خفيف على input.stock — كافٍ لأن buildCriticalLevels تتحقق
// من كل حقل رقمي بنفسها عبر Number.isFinite. لا نتحقق من كل حقول
// TradeEngineInput لأن criticalLevels تحتاج فقط stock.
function extractTradeEngineInput(
  value: unknown
): TradeEngineInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.stock !== 'object' || v.stock === null) return undefined;

  return value as TradeEngineInput;
}

// ============================================================
// 3) استخراج مباشر من analyze_trade (الأولوية 1)
// ============================================================

function findLatestToolResult(
  results: CollectedToolResult[],
  name: string
): CollectedToolResult | undefined {
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].name === name) return results[i];
  }
  return undefined;
}

const DECISION_TO_COMPACT: Record<
  SociallyAdjustedTradeReport['decision'],
  FahdCompactResponse['decision']
> = {
  BUY_CALL: 'CALL',
  BUY_PUT: 'PUT',
  WATCH: 'WAIT',
  WAIT: 'WAIT',
  REJECT_CONTRACT: 'WAIT',
};

const DIRECTION_LABELS: Record<'CALL' | 'PUT' | 'NEUTRAL', string> = {
  CALL: 'صاعد',
  PUT: 'هابط',
  NEUTRAL: 'محايد',
};

function buildTechnicalBias(report: SociallyAdjustedTradeReport): string {
  const stockLabel = DIRECTION_LABELS[report.directions.stock];
  const marketLabel = DIRECTION_LABELS[report.directions.market];
  const alignmentLabel = report.alignment ? 'متوافقان' : 'متعارضان';

  return `السهم ${stockLabel} والسوق ${marketLabel} (${alignmentLabel})`;
}

// يقارن الأصوات الثلاثة كاملة (صاعد/هابط/محايد)، لا صاعد وهابط فقط.
// أي تعادل يميل لصالح "محايد" (الخيار الأكثر تحفظًا).
function buildSocialBias(
  context: SociallyAdjustedTradeReport['socialIntelligence']
): string {
  const { bullishCount, bearishCount, neutralCount, totalSignals } = context;

  if (totalSignals === 0) {
    return 'لا توجد إشارات اجتماعية حديثة';
  }

  const max = Math.max(bullishCount, bearishCount, neutralCount);

  let dominant: string;
  if (neutralCount === max || bullishCount === bearishCount) {
    dominant = 'محايد';
  } else if (bullishCount === max) {
    dominant = 'إيجابي';
  } else {
    dominant = 'سلبي';
  }

  return `${dominant} (${bullishCount} صاعد / ${bearishCount} هابط / ${neutralCount} محايد من ${totalSignals} إشارة)`;
}

// أولوية العرض: VAL ثم POC ثم VAH ثم الدعم ثم المقاومة.
// إزالة القيم الرقمية المكررة (لو تطابقت قيمتان رقميًا).
function buildCriticalLevels(input: TradeEngineInput | undefined): string[] {
  const stock = input?.stock;
  if (!stock) return [];

  const candidates: { label: string; value: number | null | undefined }[] = [
    { label: 'VAL', value: stock.val },
    { label: 'POC', value: stock.poc },
    { label: 'VAH', value: stock.vah },
    { label: 'دعم', value: stock.support },
    { label: 'مقاومة', value: stock.resistance },
  ];

  const seenValues = new Set<number>();
  const levels: string[] = [];

  for (const candidate of candidates) {
    const { value } = candidate;

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    if (seenValues.has(value)) {
      continue;
    }

    seenValues.add(value);
    levels.push(`${candidate.label} ${value}`);
  }

  return levels.slice(0, 3);
}

// forcedWait يُفحص أولًا ويسبق أي حكم مبني على trigger === CONFIRMED،
// لأن التقرير قد يبقى BUY_CALL/BUY_PUT من محرك الصفقة الأساسي بينما
// الذكاء الاجتماعي أوقف الدخول فعليًا (forcedWait = true).
function buildNextAction(report: SociallyAdjustedTradeReport): string {
  const social = report.socialIntelligence;

  if (social.forcedWait) {
    if (social.pendingHighImpactCount > 0) {
      return 'انتظر اتضاح نتيجة الحدث مرتفع التأثير ثم أعد التحليل';
    }
    return 'لا تدخل الآن بسبب تعارض الحدث مرتفع التأثير مع اتجاه الصفقة';
  }

  if (report.decision === 'REJECT_CONTRACT') {
    return 'لا تدخل — العقد مرفوض حسب معايير الجودة والسيولة';
  }

  if (report.trigger === 'FAILED') {
    return 'التفعيل فشل — لا تدخل على هذا الإعداد حاليًا';
  }

  if (report.trigger === 'WAITING') {
    return 'انتظر تأكيد الشمعة (Trigger) قبل الدخول';
  }

  if (report.decision === 'BUY_CALL' || report.decision === 'BUY_PUT') {
    return 'التفعيل مؤكد وفق الخطة — التزم بإدارة المخاطر المحددة';
  }

  return 'راقب السهم وانتظر تأكيدًا أوضح قبل أي قرار';
}

function mapAnalyzeTradeOutput(
  report: SociallyAdjustedTradeReport,
  rawInput: unknown
): FahdCompactResponse {
  const context = report.socialIntelligence;
  const tradeInput = extractTradeEngineInput(rawInput);

  const reasons =
    report.reasons.length > 0
      ? report.reasons.slice(0, 4)
      : ['لا تتوفر أسباب مفصلة من المحرك.'];

  return {
    symbol: report.symbol,
    decision: DECISION_TO_COMPACT[report.decision],
    confidence: report.confidence,
    reasons,
    technicalBias: buildTechnicalBias(report),
    socialBias: buildSocialBias(context),
    conflict: context.conflict,
    criticalLevels: buildCriticalLevels(tradeInput),
    nextAction: buildNextAction(report),
  };
}

// ============================================================
// 4) نقطة الاستخراج الرئيسية
// ============================================================

export function extractCompactResponse(
  collectedToolResults: CollectedToolResult[]
): FahdCompactResponse | null {
  const tradeResult = findLatestToolResult(
    collectedToolResults,
    'analyze_trade'
  );

  if (tradeResult && isSociallyAdjustedTradeReport(tradeResult.output)) {
    return mapAnalyzeTradeOutput(tradeResult.output, tradeResult.input);
  }

  // TODO (الأولوية 2 - بانتظار الأشكال الفعلية):
  // دمج get_stock_decision + get_market_decision + get_recent_social_signals
  // عندما لا يتوفر analyze_trade. غير مُفعّلة الآن — لا نخمّن أسماء حقول.

  return null;
}

// ============================================================
// 5) بناء الرد النهائي من القالب الثابت (بدون Regex إطلاقًا)
// ============================================================

const MAX_COMPACT_WORDS = 180;

// تقسيم بسيط بـ Regex لعدّ الكلمات فقط (يدعم أسطر متعددة وTabs) —
// هذا ليس تحليلًا لمحتوى النص، فقط تجزئة على الفراغات لأغراض العدّ.
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function enforceWordLimit(text: string, maxWords: number): string {
  if (countWords(text) <= maxWords) return text;

  const lines = text.split('\n');

  while (countWords(lines.join(' ')) > maxWords && lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    const words = lastLine.trim().split(/\s+/).filter(Boolean);

    if (words.length <= 1) {
      lines.pop();
    } else {
      words.pop();
      lines[lines.length - 1] = words.join(' ');
    }
  }

  return lines.join('\n');
}

export function formatCompactResponse(data: FahdCompactResponse): string {
  const reasonsBlock = data.reasons
    .slice(0, 4)
    .map((reason) => `- ${reason}`)
    .join('\n');

  const criticalLevelsBlock =
    data.criticalLevels.length > 0
      ? data.criticalLevels.join(' / ')
      : 'غير محدد';

  const conflictText = data.conflict
    ? 'نعم، يوجد تعارض بين الانحياز الفني والاجتماعي'
    : 'لا يوجد تعارض';

  const response = [
    `🚦 ${data.symbol} — القرار النهائي`,
    '',
    `القرار: ${data.decision}`,
    `الثقة النهائية: ${data.confidence}%`,
    '',
    'الأسباب:',
    reasonsBlock,
    '',
    `الانحياز الفني: ${data.technicalBias}`,
    `الانحياز الاجتماعي: ${data.socialBias}`,
    `التعارض: ${conflictText}`,
    `المستوى الحاسم: ${criticalLevelsBlock}`,
    `الخطة: ${data.nextAction}`,
  ].join('\n');

  return enforceWordLimit(response, MAX_COMPACT_WORDS);
}

// ============================================================
// 6) نقطة الدخول الوحيدة التي يستدعيها route.ts
// ============================================================

export function buildFahdResponse(params: {
  userMessage: string;
  assistantText: string;
  collectedToolResults: CollectedToolResult[];
}): string {
  const { userMessage, assistantText, collectedToolResults } = params;

  // الوضع المفصل: assistantText يُستخدم كما هو، بدون أي تحليل له.
  if (isDetailedRequestMode(userMessage)) {
    return assistantText;
  }

  // الوضع المختصر: المصدر الوحيد هو collectedToolResults.
  // assistantText لا يُقرأ هنا إطلاقًا.
  const compact = extractCompactResponse(collectedToolResults);

  if (!compact) {
    return 'تعذر بناء ملخص مختصر موثوق من نتائج التحليل الحالية. اكتب "تحليل كامل" للحصول على التقرير التفصيلي.';
  }

  return formatCompactResponse(compact);
}