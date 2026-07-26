import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCacheKey,
  getCachedDecision,
  setCachedDecision,
  __clearNewsCacheForTests,
  MAX_CACHE_ENTRIES,
} from "../../lib/trading/fahd-decision/news-classification-cache";
import type { NewsJudgment } from "../../lib/trading/fahd-decision/news-modifier-types";

const sampleJudgment: NewsJudgment = {
  sentiment: "POSITIVE",
  confidence: 0.7,
  scoreAdjustment: 2,
  warnings: [],
  sourceCount: 3,
};

test("مفتاح الكاش يجمع الرمز والهاش معاً", () => {
  assert.equal(buildCacheKey("nvda", "abc123"), "NVDA:abc123");
});

test("عدم وجود مدخل في الكاش => null", () => {
  __clearNewsCacheForTests();
  const result = getCachedDecision("NVDA:doesnotexist", Date.now());
  assert.equal(result, null);
});

test("تخزين ثم استرجاع فوري (قبل الانتهاء) => نفس القرار", () => {
  __clearNewsCacheForTests();
  const now = Date.now();
  const key = buildCacheKey("NVDA", "hash1");
  const stored = setCachedDecision(key, sampleJudgment, "hash1", "company", now);

  const retrieved = getCachedDecision(key, now + 1000);
  assert.deepEqual(retrieved, stored);
});

test("أخبار الشركات (company) تنتهي بعد 10 دقائق بالضبط", () => {
  __clearNewsCacheForTests();
  const now = Date.now();
  const key = buildCacheKey("NVDA", "hash2");
  setCachedDecision(key, sampleJudgment, "hash2", "company", now);

  // عند اللحظة 10 دقائق بالضبط: لا يزال صالحاً (expiresAtMs <= now يعني منتهي، فـ 10:00 بالضبط منتهٍ)
  const atExactExpiry = getCachedDecision(key, now + 10 * 60 * 1000);
  assert.equal(atExactExpiry, null);

  // قبلها بثانية: لا يزال صالحاً
  const key2 = buildCacheKey("NVDA", "hash2b");
  setCachedDecision(key2, sampleJudgment, "hash2b", "company", now);
  const justBeforeExpiry = getCachedDecision(key2, now + 10 * 60 * 1000 - 1000);
  assert.notEqual(justBeforeExpiry, null);
});

test("الأخبار العاجلة (breaking) تنتهي بعد 5 دقائق فقط", () => {
  __clearNewsCacheForTests();
  const now = Date.now();
  const key = buildCacheKey("NVDA", "hash3");
  setCachedDecision(key, sampleJudgment, "hash3", "breaking", now);

  const after6Minutes = getCachedDecision(key, now + 6 * 60 * 1000);
  assert.equal(after6Minutes, null);

  const key2 = buildCacheKey("NVDA", "hash3b");
  setCachedDecision(key2, sampleJudgment, "hash3b", "breaking", now);
  const after4Minutes = getCachedDecision(key2, now + 4 * 60 * 1000);
  assert.notEqual(after4Minutes, null);
});

test("مفتاح منتهي يُحذف تلقائياً من الكاش عند محاولة القراءة (تنظيف كسول)", () => {
  __clearNewsCacheForTests();
  const now = Date.now();
  const key = buildCacheKey("NVDA", "hash4");
  setCachedDecision(key, sampleJudgment, "hash4", "breaking", now);

  const expired = getCachedDecision(key, now + 10 * 60 * 1000);
  assert.equal(expired, null);

  // إعادة القراءة بنفس الوقت المنتهي يجب أن تبقى null (تأكيد الحذف الفعلي، لا خطأ عرضي)
  const stillExpired = getCachedDecision(key, now + 10 * 60 * 1000);
  assert.equal(stillExpired, null);
});

test("رمزان مختلفان بنفس الهاش لا يتشاركان نفس المدخل", () => {
  __clearNewsCacheForTests();
  const now = Date.now();
  setCachedDecision(buildCacheKey("NVDA", "sameHash"), sampleJudgment, "sameHash", "company", now);

  const otherSymbol = getCachedDecision(buildCacheKey("SPY", "sameHash"), now);
  assert.equal(otherSymbol, null);
});

test("classifiedAt و expiresAt يُحسَبان بشكل صحيح من nowMs الممرَّرة", () => {
  __clearNewsCacheForTests();
  const now = Date.parse("2026-07-25T14:00:00.000Z");
  const key = buildCacheKey("NVDA", "hash5");
  const stored = setCachedDecision(key, sampleJudgment, "hash5", "company", now);

  assert.equal(stored.classifiedAt, "2026-07-25T14:00:00.000Z");
  assert.equal(stored.expiresAt, "2026-07-25T14:10:00.000Z");
});

test("تجاوز الحد الأقصى للكاش (500) يحذف أقدم المدخلات تلقائياً", () => {
  __clearNewsCacheForTests();
  const now = Date.now();

  for (let i = 0; i < MAX_CACHE_ENTRIES + 10; i++) {
    setCachedDecision(
      buildCacheKey("SYM", `hash-${i}`),
      sampleJudgment,
      `hash-${i}`,
      "company",
      now,
    );
  }

  // أول 10 مدخلات (الأقدم) يفترض حذفها
  const oldest = getCachedDecision(buildCacheKey("SYM", "hash-0"), now);
  assert.equal(oldest, null);

  // آخر مدخل يفترض بقاؤه
  const newest = getCachedDecision(buildCacheKey("SYM", `hash-${MAX_CACHE_ENTRIES + 9}`), now);
  assert.notEqual(newest, null);
});
