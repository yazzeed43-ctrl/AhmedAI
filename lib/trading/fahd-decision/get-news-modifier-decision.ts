/**
 * get-news-modifier-decision.ts
 * نقطة الدخول الوحيدة اللي يستدعيها route.ts. تربط:
 * فلترة الحداثة (30د) -> تطبيع العناوين -> بناء مفتاح الكاش -> فحص الكاش
 * -> تصنيف عند الحاجة -> تخزين.
 *
 * مهم: الهاش يُحسب من العناوين "الحديثة فقط" بعد الفلترة، وليس من القائمة
 * الخام — عشان هوية الكاش تعكس فعلياً ما تم تصنيفه، لا كل ما وصل من المصدر.
 */

import { computeHeadlineHash, filterFreshHeadlines, DEFAULT_MAX_HEADLINE_AGE_MS } from "./normalize-news-headlines";
import { classifyNews, type ClassifyFn } from "./news-classifier";
import { buildCacheKey, getCachedDecision, setCachedDecision } from "./news-classification-cache";
import type { NewsCategory, NewsModifierDecision, RawHeadline } from "./news-modifier-types";

export async function getNewsModifierDecision(
  params: {
    symbol: string;
    headlines: RawHeadline[];
    category: NewsCategory;
    maxHeadlineAgeMs?: number;
  },
  classifyFn: ClassifyFn,
  nowMs: number = Date.now(),
): Promise<NewsModifierDecision> {
  const { fresh } = filterFreshHeadlines(
    params.headlines,
    nowMs,
    params.maxHeadlineAgeMs ?? DEFAULT_MAX_HEADLINE_AGE_MS,
  );

  const headlineHash = computeHeadlineHash(params.symbol, fresh);
  const cacheKey = buildCacheKey(params.symbol, headlineHash);

  const cached = getCachedDecision(cacheKey, nowMs);
  if (cached) {
    return cached;
  }

  // classifyNews نفسها ترجع fallback فوري لو fresh فاضية (بدون استدعاء classifyFn)
  const judgment = await classifyNews({ symbol: params.symbol, headlines: fresh }, classifyFn);

  return setCachedDecision(cacheKey, judgment, headlineHash, params.category, nowMs);
}
