/**
 * news-classifier.ts
 * طبقة التصنيف الاحتمالي. لا تتصل بـ Claude مباشرة هنا — تأخذ classifyFn محقونة
 * (dependency injection) عشان تبقى قابلة للاختبار بمعزل عن أي API حقيقي.
 *
 * قاعدة صارمة: أي رد لا يطابق الشكل المتوقع تماماً => فشل مُعلَن (NEUTRAL fallback)،
 * وليس تخميناً أو محاولة "إصلاح" الرد الغريب.
 */

import {
  NEWS_ADJUSTMENT_BOUNDS,
  NEWS_CONFIDENCE_FULL_FROM,
  NEWS_CONFIDENCE_ZERO_BELOW,
  NEWS_MODIFIER_FALLBACK,
  type NewsJudgment,
  type RawHeadline,
  type Sentiment,
} from "./news-modifier-types";

const VALID_SENTIMENTS: readonly Sentiment[] = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"];

/**
 * دالة التصنيف الفعلية (حقيقية في route.ts): تستدعي Claude مصغّر بصيغة JSON فقط،
 * وترجع النص الخام للرد (قبل أي parsing). أي استثناء أو timeout هنا يُعامَل كفشل.
 */
export type ClassifyFn = (input: {
  symbol: string;
  headlines: RawHeadline[];
}) => Promise<string>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * يتحقق بصرامة من شكل الرد الخام (متوقَّع JSON) ويحوّله لـNewsJudgment.
 * يرجع null لو الشكل غير صالح — الاستدعاء الأعلى يتولى تطبيق fallback عندها.
 */
function parseAndValidateJudgment(
  rawResponse: string,
  sourceCount: number,
): NewsJudgment | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.sentiment !== "string" || !VALID_SENTIMENTS.includes(obj.sentiment as Sentiment)) {
    return null;
  }
  if (typeof obj.confidence !== "number" || !Number.isFinite(obj.confidence)) {
    return null;
  }
  if (typeof obj.scoreAdjustment !== "number" || !Number.isFinite(obj.scoreAdjustment)) {
    return null;
  }

  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];

  const clampedConfidence = clamp(obj.confidence, 0, 1);
  const clampedAdjustment = clamp(obj.scoreAdjustment, NEWS_ADJUSTMENT_BOUNDS.min, NEWS_ADJUSTMENT_BOUNDS.max);

  // سياسة الثقة: أقل من 0.55 يُصفَّر، ومن 0.55 إلى أقل من 0.75 يُطبَّق النصف،
  // ومن 0.75 فأعلى يُطبَّق كامل التعديل. sentiment/confidence يبقيان للتشخيص.
  const confidenceMultiplier =
    clampedConfidence < NEWS_CONFIDENCE_ZERO_BELOW
      ? 0
      : clampedConfidence < NEWS_CONFIDENCE_FULL_FROM
        ? 0.5
        : 1;
  const finalAdjustment =
    confidenceMultiplier === 0 ? 0 : clampedAdjustment * confidenceMultiplier;
  const finalWarnings =
    confidenceMultiplier === 0
      ? [
          ...warnings,
          `الثقة منخفضة (${clampedConfidence.toFixed(2)} < ${NEWS_CONFIDENCE_ZERO_BELOW}) — تم تجاهل تعديل الدرجة.`,
        ]
      : confidenceMultiplier === 0.5
        ? [
            ...warnings,
            `الثقة متوسطة (${clampedConfidence.toFixed(2)}) — طُبق نصف تعديل الدرجة.`,
          ]
        : warnings;

  return {
    sentiment: obj.sentiment as Sentiment,
    confidence: clampedConfidence,
    scoreAdjustment: finalAdjustment,
    warnings: finalWarnings,
    sourceCount,
    classificationSucceeded: true,
  };
}

/**
 * الدالة الرئيسية: تستدعي classifyFn المحقونة، وتتحمل فشلها بأي شكل (استثناء،
 * JSON تالف، حقول ناقصة) بإرجاع fallback مُعلَن صراحة — أبداً تخمين.
 */
export async function classifyNews(
  input: { symbol: string; headlines: RawHeadline[] },
  classifyFn: ClassifyFn,
): Promise<NewsJudgment> {
  const sourceCount = input.headlines.length;

  if (sourceCount === 0) {
    return { ...NEWS_MODIFIER_FALLBACK, sourceCount: 0 };
  }

  let rawResponse: string;
  try {
    rawResponse = await classifyFn(input);
  } catch {
    return { ...NEWS_MODIFIER_FALLBACK, sourceCount };
  }

  const judgment = parseAndValidateJudgment(rawResponse, sourceCount);
  if (!judgment) {
    return { ...NEWS_MODIFIER_FALLBACK, sourceCount };
  }

  return judgment;
}
