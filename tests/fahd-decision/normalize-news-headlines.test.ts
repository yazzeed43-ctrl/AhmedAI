import test from "node:test";
import assert from "node:assert/strict";
import { computeHeadlineHash, normalizeHeadlineSet, filterFreshHeadlines } from "../../lib/trading/fahd-decision/normalize-news-headlines";
import type { RawHeadline } from "../../lib/trading/fahd-decision/news-modifier-types";

const NOW = new Date("2026-07-25T14:00:00.000Z").getTime();
function minutesAgo(mins: number): string {
  return new Date(NOW - mins * 60_000).toISOString();
}

// ============================================================
// filterFreshHeadlines — نافذة الحداثة (30 دقيقة افتراضياً)
// ============================================================

test("عنوان بلا publishedAt إطلاقاً => يُرفض دائماً (لا نفترض حداثته)", () => {
  const headlines: RawHeadline[] = [{ title: "Untimed headline" }];
  const result = filterFreshHeadlines(headlines, NOW);
  assert.equal(result.fresh.length, 0);
  assert.equal(result.missingTimestampCount, 1);
  assert.equal(result.staleCount, 0);
});

test("عنوان بتوقيت صالح ضمن 30 دقيقة => يمر", () => {
  const headlines: RawHeadline[] = [{ title: "Fresh headline", publishedAt: minutesAgo(10) }];
  const result = filterFreshHeadlines(headlines, NOW);
  assert.equal(result.fresh.length, 1);
});

test("عنوان عمره 30 دقيقة بالضبط => يمر (الحد مُدرَج)", () => {
  const headlines: RawHeadline[] = [{ title: "Exactly 30 min", publishedAt: minutesAgo(30) }];
  const result = filterFreshHeadlines(headlines, NOW);
  assert.equal(result.fresh.length, 1);
});

test("عنوان عمره 31 دقيقة => يُستبعد (قديم)", () => {
  const headlines: RawHeadline[] = [{ title: "Stale headline", publishedAt: minutesAgo(31) }];
  const result = filterFreshHeadlines(headlines, NOW);
  assert.equal(result.fresh.length, 0);
  assert.equal(result.staleCount, 1);
});

test("توقيت غير صالح (نص عشوائي) => يُعامَل كـmissingTimestamp، لا كـstale", () => {
  const headlines: RawHeadline[] = [{ title: "Broken timestamp", publishedAt: "not-a-date" }];
  const result = filterFreshHeadlines(headlines, NOW);
  assert.equal(result.fresh.length, 0);
  assert.equal(result.missingTimestampCount, 1);
});

test("توقيت مستقبلي (بيانات مريبة) => يُستبعد كـstale، لا يمر بحجة إنه 'حديث جداً'", () => {
  const futureHeadline: RawHeadline[] = [
    { title: "Future headline", publishedAt: new Date(NOW + 5 * 60_000).toISOString() },
  ];
  const result = filterFreshHeadlines(futureHeadline, NOW);
  assert.equal(result.fresh.length, 0);
  assert.equal(result.staleCount, 1);
});

test("نافذة حداثة مخصصة (مثلاً ساعتين) بدل الافتراضي", () => {
  const headlines: RawHeadline[] = [{ title: "Older but within custom window", publishedAt: minutesAgo(90) }];
  const result = filterFreshHeadlines(headlines, NOW, 2 * 60 * 60 * 1000);
  assert.equal(result.fresh.length, 1);
});

test("مزيج من عناوين حديثة وقديمة ومفقودة التوقيت => فرز صحيح لكل فئة", () => {
  const headlines: RawHeadline[] = [
    { title: "Fresh one", publishedAt: minutesAgo(5) },
    { title: "Stale one", publishedAt: minutesAgo(60) },
    { title: "No timestamp" },
  ];
  const result = filterFreshHeadlines(headlines, NOW);
  assert.equal(result.fresh.length, 1);
  assert.equal(result.staleCount, 1);
  assert.equal(result.missingTimestampCount, 1);
});

// ============================================================
// الهاش والتطبيع (كما سابقاً)
// ============================================================

test("الهاش لا يتأثر بترتيب العناوين", () => {
  const a: RawHeadline[] = [{ title: "Fed hints at rate cut" }, { title: "NVDA earnings beat" }];
  const b: RawHeadline[] = [{ title: "NVDA earnings beat" }, { title: "Fed hints at rate cut" }];
  assert.equal(computeHeadlineHash("NVDA", a), computeHeadlineHash("NVDA", b));
});

test("الهاش لا يتأثر باختلاف حالة الأحرف أو المسافات الزائدة", () => {
  const a: RawHeadline[] = [{ title: "  NVDA Earnings BEAT  " }];
  const b: RawHeadline[] = [{ title: "nvda earnings beat" }];
  assert.equal(computeHeadlineHash("NVDA", a), computeHeadlineHash("NVDA", b));
});

test("الهاش يتغيّر عند تغيّر المحتوى الفعلي", () => {
  const a: RawHeadline[] = [{ title: "NVDA earnings beat" }];
  const b: RawHeadline[] = [{ title: "NVDA earnings miss" }];
  assert.notEqual(computeHeadlineHash("NVDA", a), computeHeadlineHash("NVDA", b));
});

test("الهاش يتغيّر عند تغيّر publishedAt لنفس العنوان", () => {
  const first = computeHeadlineHash("SPXW", [
    { title: "Fed update", publishedAt: "2026-07-25T10:00:00.000Z" },
  ]);
  const second = computeHeadlineHash("SPXW", [
    { title: "Fed update", publishedAt: "2026-07-25T10:05:00.000Z" },
  ]);

  assert.notEqual(first, second);
});

test("الهاش يختلف بين الرموز حتى مع نفس العناوين", () => {
  const headlines: RawHeadline[] = [{ title: "Fed hints at rate cut" }];
  assert.notEqual(computeHeadlineHash("NVDA", headlines), computeHeadlineHash("SPY", headlines));
});

test("العناوين المكرَّرة (بعد التطبيع) تُفرَّد ولا تُضاعِف الهاش", () => {
  const withDup: RawHeadline[] = [{ title: "NVDA earnings beat" }, { title: "nvda earnings beat" }];
  const withoutDup: RawHeadline[] = [{ title: "NVDA earnings beat" }];
  assert.equal(computeHeadlineHash("NVDA", withDup), computeHeadlineHash("NVDA", withoutDup));
});

test("normalizeHeadlineSet يتجاهل العناوين الفارغة", () => {
  const headlines: RawHeadline[] = [{ title: "  " }, { title: "Real headline" }];
  assert.deepEqual(normalizeHeadlineSet(headlines), ["real headline"]);
});
