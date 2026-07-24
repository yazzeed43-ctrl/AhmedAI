import type { TradierOpportunity } from "./types";

// أي نوع فيه نفس الحقول المستخدمة بترتيب التعادل (score, activityScore,
// volume, openInterest) يقدر يستخدم هذا المقارن — سواء قبل أو بعد
// إثراء IV، بما إن الحقول الأربعة موجودة بالحالتين.
interface RankableOpportunity {
  score: number;
  volume: number;
  openInterest: number;
  optionBrain: {
    metrics: {
      activityScore: number;
    };
  };
}

// نفس ترتيب التعادل الحالي حرفيًا:
// score → optionBrain.metrics.activityScore → volume → openInterest
export function compareOpportunities<T extends RankableOpportunity>(
  first: T,
  second: T,
): number {
  return (
    second.score - first.score ||
    second.optionBrain.metrics.activityScore -
      first.optionBrain.metrics.activityScore ||
    second.volume - first.volume ||
    second.openInterest - first.openInterest
  );
}

// قائمة مختصرة قبل إثراء IV (تقليل عدد الاستدعاءات لخدمة IV history
// لعقود ما راح تدخل النتيجة النهائية أصلًا)
export function createShortlist<T extends RankableOpportunity>(
  opportunities: T[],
  resultLimit: number,
): T[] {
  const shortlistLimit = Math.min(
    opportunities.length,
    Math.max(resultLimit * 3, 10),
  );

  return [...opportunities].sort(compareOpportunities).slice(0, shortlistLimit);
}

// الترتيب النهائي بعد إثراء IV + إضافة rank
export function rankOpportunities(
  enriched: Omit<TradierOpportunity, "rank">[],
  resultLimit: number,
): TradierOpportunity[] {
  return [...enriched]
    .sort(compareOpportunities)
    .slice(0, resultLimit)
    .map((item, index) => ({ rank: index + 1, ...item }));
}
