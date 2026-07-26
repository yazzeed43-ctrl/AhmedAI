/**
 * news-classification-cache.ts
 * كاش بسيط في الذاكرة (Map) — نفس نمط الكاش الموحّد اللي استخدمته لـTwelve Data.
 * المفتاح: symbol + headlineHash (وليس الرمز فقط)، حتى لا يُعاد استخدام تصنيف
 * قديم بعد وصول خبر جديد فعلياً يغيّر مجموعة العناوين.
 */

import { NEWS_CACHE_DURATIONS_MS, type NewsCategory, type NewsModifierDecision } from "./news-modifier-types";

type CacheEntry = { decision: NewsModifierDecision; expiresAtMs: number };

const cache = new Map<string, CacheEntry>();

/** حد أقصى لعدد مدخلات الكاش — يمنع النمو غير المحدود داخل نسخة الخادم طويلة العمر */
export const MAX_CACHE_ENTRIES = 500;

/** يحذف أقدم المدخلات (بترتيب الإدراج، Map يحافظ عليه في JS) حتى نعود ضمن الحد */
function enforceMaxCacheSize(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function buildCacheKey(symbol: string, headlineHash: string): string {
  return `${symbol.toUpperCase()}:${headlineHash}`;
}

/** يرجع القرار المخزَّن لو موجود وغير منتهٍ الصلاحية، وإلا null */
export function getCachedDecision(key: string, nowMs: number): NewsModifierDecision | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    cache.delete(key);
    return null;
  }
  return entry.decision;
}

/**
 * يخزّن القرار مع وسم classifiedAt/expiresAt بناءً على فئة الخبر (عاجل/شركة).
 * يرجع القرار الكامل (مع الطوابع الزمنية) جاهزاً للاستخدام مباشرة.
 */
export function setCachedDecision(
  key: string,
  judgment: Omit<NewsModifierDecision, "classifiedAt" | "expiresAt" | "headlineHash">,
  headlineHash: string,
  category: NewsCategory,
  nowMs: number,
): NewsModifierDecision {
  const durationMs = NEWS_CACHE_DURATIONS_MS[category];
  const decision: NewsModifierDecision = {
    ...judgment,
    headlineHash,
    classifiedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + durationMs).toISOString(),
  };

  cache.set(key, { decision, expiresAtMs: nowMs + durationMs });
  enforceMaxCacheSize();
  return decision;
}

/** لأغراض الاختبار فقط — تفريغ الكاش بين الحالات */
export function __clearNewsCacheForTests(): void {
  cache.clear();
}
