/**
 * apply-news-modifier.ts
 *
 * قاعدة "عدم إنقاذ العقد الضعيف" (قرار يزيد الشريف):
 * - العتبة: minimumFinalScore = 72 افتراضياً، قابلة للتمرير.
 * - baseEligible = baseFinalScore >= minimumFinalScore
 * - لو baseEligible === false: أي تعديل موجب (بعد مواءمة الاتجاه) يُصفَّر تماماً.
 * - الخبر السلبي (بعد المواءمة) يُطبَّق دائماً بغض النظر عن الأهلية.
 *
 * مواءمة الاتجاه (إصلاح فجوة حرجة): المصنّف يحكم على اتجاه السوق/السهم فقط
 * (POSITIVE = صعودي، NEGATIVE = هبوطي) بمعزل عن نوع الصفقة. الدالة هنا هي من
 * تُسقط هذا الحكم على الصفقة الفعلية:
 *   - CALL: الاتجاه الصعودي يخدم الصفقة => التعديل يُطبَّق كما هو.
 *   - PUT: الاتجاه الصعودي يضر الصفقة => يُعكَس الإشارة (خبر إيجابي على السهم
 *     يتحول لتعديل سالب على صفقة PUT، والعكس صحيح للخبر السلبي).
 *   - NEUTRAL/MIXED: لا اتجاه واضح يُعكَس — يُطبَّق كما هو بلا انعكاس.
 * بعد الانعكاس، يُعاد تقييد القيمة لنفس الحدود [-8,+4] — لأن انعكاس -8 مثلاً
 * ينتج +8 وهذا يتجاوز الحد الأقصى المسموح للتعديل الموجب.
 */

import { NEWS_ADJUSTMENT_BOUNDS, type NewsModifierDecision, type PositionSide } from "./news-modifier-types";

const DEFAULT_MINIMUM_FINAL_SCORE = 72;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** يُسقط حكم الاتجاه (سعودي/هبوطي) على نوع الصفقة الفعلي، مع إعادة تقييد الحدود بعد الانعكاس */
function alignAdjustmentWithPositionSide(
  adjustment: number,
  sentiment: NewsModifierDecision["sentiment"],
  positionSide: PositionSide,
): number {
  if (sentiment === "NEUTRAL" || sentiment === "MIXED") return 0;

  const magnitude = Math.abs(adjustment);
  const supportsTrade =
    (sentiment === "POSITIVE" && positionSide === "CALL") ||
    (sentiment === "NEGATIVE" && positionSide === "PUT");

  return supportsTrade
    ? Math.min(magnitude, NEWS_ADJUSTMENT_BOUNDS.max)
    : -Math.min(magnitude, Math.abs(NEWS_ADJUSTMENT_BOUNDS.min));
}

export type NewsModifierApplication = {
  baseFinalScore: number;
  adjustedFinalScore: number;
  appliedAdjustment: number;
  baseEligible: boolean;
  eligibleAfterNews: boolean;
  positiveBoostBlocked: boolean;
  positionSide: PositionSide;
  modifier: NewsModifierDecision;
};

export function applyNewsModifier(
  baseFinalScore: number,
  modifier: NewsModifierDecision,
  params: {
    positionSide: PositionSide;
    minimumFinalScore?: number;
  },
): NewsModifierApplication {
  const minimumFinalScore = params.minimumFinalScore ?? DEFAULT_MINIMUM_FINAL_SCORE;

  // إعادة تقييد دفاعية أولى — حتى لو الكاش أو التصنيف احتوى قيمة خارج الحدود
  const safeAdjustment = clamp(
    modifier.scoreAdjustment,
    NEWS_ADJUSTMENT_BOUNDS.min,
    NEWS_ADJUSTMENT_BOUNDS.max,
  );

  // مواءمة الاتجاه مع نوع الصفقة (CALL/PUT) — الإصلاح الأهم
  const directionalAdjustment = alignAdjustmentWithPositionSide(
    safeAdjustment,
    modifier.sentiment,
    params.positionSide,
  );

  const baseEligible = baseFinalScore >= minimumFinalScore;
  const positiveBoostBlocked = directionalAdjustment > 0 && !baseEligible;
  const effectiveAdjustment = positiveBoostBlocked ? 0 : directionalAdjustment;

  const adjustedFinalScore = clamp(baseFinalScore + effectiveAdjustment, 0, 100);

  return {
    baseFinalScore,
    adjustedFinalScore,
    appliedAdjustment: effectiveAdjustment,
    baseEligible,
    eligibleAfterNews: baseEligible && adjustedFinalScore >= minimumFinalScore,
    positiveBoostBlocked,
    positionSide: params.positionSide,
    modifier,
  };
}
