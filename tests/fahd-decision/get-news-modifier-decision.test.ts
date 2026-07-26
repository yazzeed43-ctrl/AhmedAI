import test from "node:test";
import assert from "node:assert/strict";
import { getNewsModifierDecision } from "../../lib/trading/fahd-decision/get-news-modifier-decision";
import { __clearNewsCacheForTests } from "../../lib/trading/fahd-decision/news-classification-cache";
import type { ClassifyFn } from "../../lib/trading/fahd-decision/news-classifier";
import type { RawHeadline } from "../../lib/trading/fahd-decision/news-modifier-types";

function freshHeadline(title: string, nowMs: number, minutesAgo = 2): RawHeadline {
  return { title, publishedAt: new Date(nowMs - minutesAgo * 60_000).toISOString() };
}

test("استدعاءان متتاليان بنفس العناوين الحديثة => classifyFn تُستدعى مرة واحدة فقط (الثانية من الكاش)", async () => {
  __clearNewsCacheForTests();
  let callCount = 0;
  const classifyFn: ClassifyFn = async () => {
    callCount += 1;
    return JSON.stringify({ sentiment: "POSITIVE", confidence: 0.8, scoreAdjustment: 3, warnings: [] });
  };

  const now = Date.now();
  const headlines: RawHeadline[] = [freshHeadline("NVDA beats earnings", now)];

  const first = await getNewsModifierDecision({ symbol: "NVDA", headlines, category: "company" }, classifyFn, now);
  const second = await getNewsModifierDecision(
    { symbol: "NVDA", headlines, category: "company" },
    classifyFn,
    now + 1000,
  );

  assert.equal(callCount, 1);
  assert.deepEqual(first, second);
});

test("تغيّر العناوين فعلياً => classifyFn تُستدعى من جديد (هاش مختلف)", async () => {
  __clearNewsCacheForTests();
  let callCount = 0;
  const classifyFn: ClassifyFn = async () => {
    callCount += 1;
    return JSON.stringify({ sentiment: "NEUTRAL", confidence: 0.5, scoreAdjustment: 0, warnings: [] });
  };

  const now = Date.now();
  await getNewsModifierDecision(
    { symbol: "NVDA", headlines: [freshHeadline("NVDA beats earnings", now)], category: "company" },
    classifyFn,
    now,
  );
  await getNewsModifierDecision(
    { symbol: "NVDA", headlines: [freshHeadline("NVDA misses earnings", now)], category: "company" },
    classifyFn,
    now,
  );

  assert.equal(callCount, 2);
});

test("بعد انتهاء الكاش => استدعاء جديد لـclassifyFn حتى مع نفس العناوين", async () => {
  __clearNewsCacheForTests();
  let callCount = 0;
  const classifyFn: ClassifyFn = async () => {
    callCount += 1;
    return JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.6, scoreAdjustment: -4, warnings: [] });
  };

  const now = Date.now();
  const headlines: RawHeadline[] = [freshHeadline("Breaking: Fed emergency meeting", now, 1)];

  await getNewsModifierDecision({ symbol: "SPY", headlines, category: "breaking" }, classifyFn, now);
  // بعد 6 دقائق: كاش breaking (5 دقائق) منتهٍ
  await getNewsModifierDecision({ symbol: "SPY", headlines, category: "breaking" }, classifyFn, now + 6 * 60 * 1000);

  assert.equal(callCount, 2);
});

test("عناوين بلا publishedAt => تُفلتَر بالكامل، لا تصل classifyFn إطلاقاً", async () => {
  __clearNewsCacheForTests();
  let called = false;
  const classifyFn: ClassifyFn = async () => {
    called = true;
    return JSON.stringify({ sentiment: "POSITIVE", confidence: 0.9, scoreAdjustment: 4, warnings: [] });
  };

  const now = Date.now();
  const headlines: RawHeadline[] = [{ title: "Untimed headline, no publishedAt" }];

  const result = await getNewsModifierDecision({ symbol: "NVDA", headlines, category: "company" }, classifyFn, now);

  assert.equal(called, false);
  assert.equal(result.sentiment, "NEUTRAL");
  assert.equal(result.scoreAdjustment, 0);
});

test("عناوين قديمة (>30 دقيقة) => تُفلتَر، لا تصل classifyFn", async () => {
  __clearNewsCacheForTests();
  let called = false;
  const classifyFn: ClassifyFn = async () => {
    called = true;
    return JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.9, scoreAdjustment: -8, warnings: [] });
  };

  const now = Date.now();
  const headlines: RawHeadline[] = [freshHeadline("Old headline", now, 45)];

  const result = await getNewsModifierDecision({ symbol: "NVDA", headlines, category: "company" }, classifyFn, now);

  assert.equal(called, false);
  assert.equal(result.sentiment, "NEUTRAL");
});
