import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEconomicImpact,
  normalizeEconomicTimestamp,
} from "../../lib/trading/fahd-decision/fahd-economic-gate-integration";

test("يتعرف على impact كرقم: 3 => high, 2 => medium, 0/1 => low", () => {
  assert.deepEqual(normalizeEconomicImpact(3), { impact: "high", valid: true });
  assert.deepEqual(normalizeEconomicImpact(2), { impact: "medium", valid: true });
  assert.deepEqual(normalizeEconomicImpact(1), { impact: "low", valid: true });
  assert.deepEqual(normalizeEconomicImpact(0), { impact: "low", valid: true });
});

test("يتعرف على impact كنص: 'high'/'medium'/'low' وصيغ بديلة", () => {
  assert.deepEqual(normalizeEconomicImpact("high"), { impact: "high", valid: true });
  assert.deepEqual(normalizeEconomicImpact("Medium"), { impact: "medium", valid: true });
  assert.deepEqual(normalizeEconomicImpact("med"), { impact: "medium", valid: true });
  assert.deepEqual(normalizeEconomicImpact("LOW"), { impact: "low", valid: true });
  assert.deepEqual(normalizeEconomicImpact("3"), { impact: "high", valid: true });
});

test("قيمة غير معروفة (نص عشوائي) => low لكن valid:false، وليست فشلاً صامتاً", () => {
  const result = normalizeEconomicImpact("severe");
  assert.equal(result.impact, "low");
  assert.equal(result.valid, false);
});

test("قيمة null/undefined => low و valid:false", () => {
  assert.deepEqual(normalizeEconomicImpact(null), { impact: "low", valid: false });
  assert.deepEqual(normalizeEconomicImpact(undefined), { impact: "low", valid: false });
});

test("NaN أو رقم غير منتهٍ => low و valid:false", () => {
  assert.deepEqual(normalizeEconomicImpact(NaN), { impact: "low", valid: false });
  assert.deepEqual(normalizeEconomicImpact(Infinity), { impact: "low", valid: false });
});

test("مسافات بيضاء حول النص تُعالج بشكل صحيح (trim قبل المقارنة)", () => {
  assert.deepEqual(normalizeEconomicImpact("  high  "), { impact: "high", valid: true });
});

test("economic event with date only is rejected because it has no precise time", () => {
  assert.equal(normalizeEconomicTimestamp({ date: "2026-07-25" }), null);
});

test("economic event accepts datetime or date combined with time", () => {
  assert.equal(
    normalizeEconomicTimestamp({ datetime: "2026-07-25T14:30:00.000Z" }),
    "2026-07-25T14:30:00.000Z",
  );
  assert.equal(
    normalizeEconomicTimestamp({ date: "2026-07-25", time: "14:30:00Z" }),
    "2026-07-25T14:30:00.000Z",
  );
});
