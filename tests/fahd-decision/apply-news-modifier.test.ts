import test from "node:test";
import assert from "node:assert/strict";
import { applyNewsModifier } from "../../lib/trading/fahd-decision/apply-news-modifier";
import type { NewsModifierDecision } from "../../lib/trading/fahd-decision/news-modifier-types";

function makeModifier(scoreAdjustment: number, sentiment: NewsModifierDecision["sentiment"] = "POSITIVE"): NewsModifierDecision {
  return {
    sentiment,
    confidence: 0.8,
    scoreAdjustment,
    warnings: [],
    sourceCount: 2,
    classifiedAt: "2026-07-25T14:00:00.000Z",
    expiresAt: "2026-07-25T14:10:00.000Z",
    headlineHash: "abc123",
  };
}

// ============================================================
// أمثلة يزيد الشريف الثلاثة، حرفياً (positionSide: CALL — الحالة الأصلية)
// ============================================================

test("مثال 1: Base 69 (غير مؤهل) + خبر إيجابي +4 (CALL) => يبقى 69، غير مؤهل", () => {
  const result = applyNewsModifier(69, makeModifier(4, "POSITIVE"), { positionSide: "CALL" });
  assert.equal(result.adjustedFinalScore, 69);
  assert.equal(result.baseEligible, false);
  assert.equal(result.positiveBoostBlocked, true);
});

test("مثال 2: Base 74 (مؤهل) + خبر إيجابي +4 (CALL) => 78", () => {
  const result = applyNewsModifier(74, makeModifier(4, "POSITIVE"), { positionSide: "CALL" });
  assert.equal(result.adjustedFinalScore, 78);
  assert.equal(result.eligibleAfterNews, true);
});

test("مثال 3: Base 74 (مؤهل) + خبر سلبي -8 (CALL) => 66، يُستبعد", () => {
  const result = applyNewsModifier(74, makeModifier(-8, "NEGATIVE"), { positionSide: "CALL" });
  assert.equal(result.adjustedFinalScore, 66);
  assert.equal(result.eligibleAfterNews, false);
});

// ============================================================
// مواءمة الاتجاه — الإصلاح الأهم: PUT يعكس الإشارة للأخبار الاتجاهية
// ============================================================

test("PUT + خبر إيجابي على السهم (+4 من المصنّف) => يتحول لتعديل سالب على الصفقة (-4)", () => {
  const result = applyNewsModifier(80, makeModifier(4, "POSITIVE"), { positionSide: "PUT" });
  assert.equal(result.appliedAdjustment, -4);
  assert.equal(result.adjustedFinalScore, 76);
});

test("PUT + خبر سلبي على السهم (-8 من المصنّف) => يتحول لتعديل موجب على الصفقة (+8 مُقيَّد إلى +4)", () => {
  const result = applyNewsModifier(74, makeModifier(-8, "NEGATIVE"), { positionSide: "PUT" });
  // العكس الرياضي لـ-8 هو +8، لكن يجب إعادة تقييده لحدود [-8,+4]
  assert.equal(result.appliedAdjustment, 4);
  assert.equal(result.adjustedFinalScore, 78);
});

test("PUT + خبر سلبي متوسط (-3) => ينعكس لـ+3، ويُحظر لو العقد غير مؤهل أصلاً", () => {
  const result = applyNewsModifier(65, makeModifier(-3, "NEGATIVE"), { positionSide: "PUT" });
  // بعد الانعكاس التعديل موجب (+3) على عقد غير مؤهل (65 < 72) => يُحظر
  assert.equal(result.positiveBoostBlocked, true);
  assert.equal(result.appliedAdjustment, 0);
  assert.equal(result.adjustedFinalScore, 65);
});

test("CALL + نفس الخبر السلبي (-3) => يُطبَّق طبيعياً بدون انعكاس (يخفض عقد ضعيف أصلاً أكثر)", () => {
  const result = applyNewsModifier(65, makeModifier(-3, "NEGATIVE"), { positionSide: "CALL" });
  assert.equal(result.positiveBoostBlocked, false);
  assert.equal(result.appliedAdjustment, -3);
  assert.equal(result.adjustedFinalScore, 62);
});

test("NEUTRAL sentiment + PUT => لا انعكاس (لا اتجاه واضح يُعكَس)، القيمة (عادة 0) تبقى كما هي", () => {
  const result = applyNewsModifier(80, makeModifier(0, "NEUTRAL"), { positionSide: "PUT" });
  assert.equal(result.appliedAdjustment, 0);
  assert.equal(result.adjustedFinalScore, 80);
});

test("MIXED sentiment + PUT => لا انعكاس (إشارات متضاربة، لا اتجاه واحد نعكسه)", () => {
  const result = applyNewsModifier(80, makeModifier(-2, "MIXED"), { positionSide: "PUT" });
  assert.equal(result.appliedAdjustment, 0);
});

test("PUT + خبر إيجابي على عقد غير مؤهل أصلاً => بعد الانعكاس يصبح سالباً، فلا يوجد شيء يُحظَر أصلاً", () => {
  const result = applyNewsModifier(65, makeModifier(4, "POSITIVE"), { positionSide: "PUT" });
  // +4 على السهم -> -4 على PUT (سالب، وليس موجباً)، فلا ينطبق شرط positiveBoostBlocked
  assert.equal(result.positiveBoostBlocked, false);
  assert.equal(result.appliedAdjustment, -4);
  assert.equal(result.adjustedFinalScore, 61);
});

// ============================================================
// عتبة مخصصة + القص الدفاعي (كما سابقاً)
// ============================================================

test("عتبة مخصصة (60) بدل الافتراضية (72)", () => {
  const result = applyNewsModifier(65, makeModifier(4, "POSITIVE"), { positionSide: "CALL", minimumFinalScore: 60 });
  assert.equal(result.baseEligible, true);
  assert.equal(result.adjustedFinalScore, 69);
});

test("النتيجة لا تتجاوز 100 حتى مع عقد مؤهل بدرجة عالية جداً", () => {
  const result = applyNewsModifier(99, makeModifier(4, "POSITIVE"), { positionSide: "CALL" });
  assert.equal(result.adjustedFinalScore, 100);
});

test("النتيجة لا تقل عن 0 حتى مع خفض حاد على عقد ضعيف", () => {
  const result = applyNewsModifier(3, makeModifier(-8, "NEGATIVE"), { positionSide: "CALL" });
  assert.equal(result.adjustedFinalScore, 0);
});

test("baseFinalScore محفوظ في النتيجة دائماً، منفصل عن adjustedFinalScore", () => {
  const result = applyNewsModifier(74, makeModifier(4, "POSITIVE"), { positionSide: "CALL" });
  assert.equal(result.baseFinalScore, 74);
  assert.notEqual(result.baseFinalScore, result.adjustedFinalScore);
});

test("positionSide يُحفَظ في النتيجة للتتبع/الـlogs", () => {
  const result = applyNewsModifier(74, makeModifier(4, "POSITIVE"), { positionSide: "PUT" });
  assert.equal(result.positionSide, "PUT");
});

test("POSITIVE sentiment controls direction even when Claude returns a negative number", () => {
  const contradictory = makeModifier(-8, "POSITIVE");

  const call = applyNewsModifier(74, contradictory, { positionSide: "CALL" });
  const put = applyNewsModifier(74, contradictory, { positionSide: "PUT" });

  assert.equal(call.appliedAdjustment, 4);
  assert.equal(put.appliedAdjustment, -8);
});

test("NEGATIVE sentiment controls direction even when Claude returns a positive number", () => {
  const contradictory = makeModifier(4, "NEGATIVE");

  const call = applyNewsModifier(74, contradictory, { positionSide: "CALL" });
  const put = applyNewsModifier(74, contradictory, { positionSide: "PUT" });

  assert.equal(call.appliedAdjustment, -4);
  assert.equal(put.appliedAdjustment, 4);
});

test("NEUTRAL and MIXED never change the score even if Claude returns a number", () => {
  for (const sentiment of ["NEUTRAL", "MIXED"] as const) {
    const result = applyNewsModifier(
      74,
      makeModifier(-8, sentiment),
      { positionSide: "CALL" },
    );
    assert.equal(result.appliedAdjustment, 0);
  }
});
