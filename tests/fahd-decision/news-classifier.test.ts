import test from "node:test";
import assert from "node:assert/strict";
import { classifyNews, type ClassifyFn } from "../../lib/trading/fahd-decision/news-classifier";
import type { RawHeadline } from "../../lib/trading/fahd-decision/news-modifier-types";

const headlines: RawHeadline[] = [{ title: "NVDA beats earnings estimates" }];

test("رد صالح تماماً => يُقبل كما هو (ضمن الحدود)", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({
      sentiment: "POSITIVE",
      confidence: 0.8,
      scoreAdjustment: 3,
      warnings: [],
    });

  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.sentiment, "POSITIVE");
  assert.equal(result.confidence, 0.8);
  assert.equal(result.scoreAdjustment, 3);
  assert.equal(result.sourceCount, 1);
});

test("scoreAdjustment خارج الحدود (+10) => يُقيَّد إلى الحد الأقصى +4", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.9, scoreAdjustment: 10, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, 4);
});

test("scoreAdjustment خارج الحدود (-20) => يُقيَّد إلى الحد الأدنى -8", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.9, scoreAdjustment: -20, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, -8);
});

test("confidence خارج [0,1] => يُقيَّد", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEUTRAL", confidence: 1.5, scoreAdjustment: 0, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.confidence, 1);
});

test("JSON تالف (parse error) => fallback NEUTRAL معلَن، وليس تخميناً", async () => {
  const classifyFn: ClassifyFn = async () => "this is not json {{{";
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.sentiment, "NEUTRAL");
  assert.equal(result.scoreAdjustment, 0);
  assert.deepEqual(result.warnings, ["تعذر تصنيف أثر الأخبار الحالية."]);
  assert.equal(result.sourceCount, 1); // نحتفظ بعدد المصادر حتى عند الفشل
});

test("sentiment بقيمة غير معروفة (خارج الأربع المسموحة) => fallback NEUTRAL", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "SUPER_BULLISH", confidence: 0.9, scoreAdjustment: 4, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.sentiment, "NEUTRAL");
  assert.equal(result.scoreAdjustment, 0);
});

test("حقل scoreAdjustment مفقود => fallback NEUTRAL (لا نفترض 0 كنجاح)", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.9, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.sentiment, "NEUTRAL");
  assert.deepEqual(result.warnings, ["تعذر تصنيف أثر الأخبار الحالية."]);
});

test("classifyFn يرمي استثناء (timeout مثلاً) => fallback NEUTRAL", async () => {
  const classifyFn: ClassifyFn = async () => {
    throw new Error("Claude request timed out");
  };
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.sentiment, "NEUTRAL");
  assert.equal(result.scoreAdjustment, 0);
});

test("لا عناوين أصلاً => fallback فوري دون استدعاء classifyFn إطلاقاً", async () => {
  let called = false;
  const classifyFn: ClassifyFn = async () => {
    called = true;
    return JSON.stringify({ sentiment: "POSITIVE", confidence: 1, scoreAdjustment: 4, warnings: [] });
  };
  const result = await classifyNews({ symbol: "NVDA", headlines: [] }, classifyFn);
  assert.equal(called, false);
  assert.equal(result.sentiment, "NEUTRAL");
  assert.equal(result.sourceCount, 0);
});

test("warnings تحتوي عناصر غير نصية => تُفلتَر وتبقى النصوص فقط", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({
      sentiment: "MIXED",
      confidence: 0.8,
      scoreAdjustment: -2,
      warnings: ["تحذير حقيقي", 123, null, "تحذير آخر"],
    });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.deepEqual(result.warnings, ["تحذير حقيقي", "تحذير آخر"]);
});

// ============================================================
// سياسة الثقة: أقل من 0.55 صفر، 0.55–0.74 نصف، و0.75 فأعلى كامل
// ============================================================

test("confidence = 0.05 (أقل من 0.55) => scoreAdjustment يُصفَّر", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.05, scoreAdjustment: -8, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, 0);
  assert.equal(result.confidence, 0.05); // تبقى كما وردت للعلم
  assert.equal(result.sentiment, "NEGATIVE"); // sentiment يبقى كما هو أيضاً
  assert.ok(result.warnings.some((w) => w.includes("الثقة منخفضة")));
});

test("confidence = 0.3 (أقل من 0.55) => scoreAdjustment يُصفَّر", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.3, scoreAdjustment: 3, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, 0);
});

test("confidence = 0.29 (أقل من 0.55) => scoreAdjustment يُصفَّر", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.29, scoreAdjustment: 3, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, 0);
});

test("confidence عالية (0.9) => لا يُضاف أي تحذير متعلق بالثقة", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.9, scoreAdjustment: 3, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.warnings.length, 0);
});

test("confidence below 0.55 removes the adjustment", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.54, scoreAdjustment: -8, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, 0);
});

test("confidence from 0.55 through 0.74 applies half adjustment", async () => {
  for (const confidence of [0.55, 0.74]) {
    const classifyFn: ClassifyFn = async () =>
      JSON.stringify({ sentiment: "NEGATIVE", confidence, scoreAdjustment: -8, warnings: [] });
    const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
    assert.equal(result.scoreAdjustment, -4);
  }
});

test("confidence at 0.75 applies the full adjustment", async () => {
  const classifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.75, scoreAdjustment: -8, warnings: [] });
  const result = await classifyNews({ symbol: "NVDA", headlines }, classifyFn);
  assert.equal(result.scoreAdjustment, -8);
});
