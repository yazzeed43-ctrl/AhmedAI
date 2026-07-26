/**
 * news-modifier-types.ts
 * الأنواع المشتركة لطبقة تصنيف الأخبار الاحتمالي (Grade Modifier، وليس Hard Gate).
 */

export type Sentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";

/** breaking = أخبار عاجلة (كاش أقصر)، company = أخبار شركات عادية (كاش أطول) */
export type NewsCategory = "breaking" | "company";

export const NEWS_ADJUSTMENT_BOUNDS = { min: -8, max: 4 } as const;

/** حد الثقة الأدنى لقبول تعديل الدرجة — تحته يُصفَّر scoreAdjustment (يبقى sentiment/confidence كما وردا للعلم فقط) */
export const NEWS_CONFIDENCE_ZERO_BELOW = 0.55;
export const NEWS_CONFIDENCE_FULL_FROM = 0.75;

/** اتجاه الصفقة — يُستخدم لمواءمة اتجاه تعديل الأخبار مع اتجاه الصفقة الفعلي */
export type PositionSide = "CALL" | "PUT";

export const NEWS_CACHE_DURATIONS_MS: Record<NewsCategory, number> = {
  breaking: 5 * 60 * 1000,
  company: 10 * 60 * 1000,
};

export type RawHeadline = {
  title: string;
  source?: string;
  publishedAt?: string;
};

/**
 * الحكم الأساسي الناتج عن التصنيف (قبل إضافة metadata الكاش/الهاش).
 */
export type NewsJudgment = {
  sentiment: Sentiment;
  confidence: number; // 0..1
  scoreAdjustment: number; // NEWS_ADJUSTMENT_BOUNDS.min..max
  warnings: string[];
  sourceCount: number;
  /** Explicit classifier outcome; avoids inferring failure from warning text. */
  classificationSucceeded?: boolean;
};

/**
 * العقد الكامل المعتمد — كما يُخزَّن في الكاش ويُستخدم في القرار النهائي.
 */
export type NewsModifierDecision = NewsJudgment & {
  classifiedAt: string;
  expiresAt: string;
  headlineHash: string;
};

/** القيمة الافتراضية عند فشل التصنيف — تصريح بالفشل، وليس تخميناً */
export const NEWS_MODIFIER_FALLBACK: Omit<NewsJudgment, "sourceCount"> = {
  sentiment: "NEUTRAL",
  confidence: 0,
  scoreAdjustment: 0,
  warnings: ["تعذر تصنيف أثر الأخبار الحالية."],
  classificationSucceeded: false,
};
