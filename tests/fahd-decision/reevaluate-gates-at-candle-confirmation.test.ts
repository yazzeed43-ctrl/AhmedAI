import test from "node:test";
import assert from "node:assert/strict";
import { reevaluateGatesAtCandleConfirmation } from "../../lib/trading/fahd-decision/reevaluate-gates-at-candle-confirmation";
import type { EconomicGateDecision } from "../../lib/trading/fahd-decision/economic-calendar-gate";
import type { NewsModifierApplication } from "../../lib/trading/fahd-decision/apply-news-modifier";

function noneGate(): EconomicGateDecision {
  return {
    level: "NONE",
    blockNewTrades: false,
    warnExistingPositions: false,
    existingPositionAction: "NONE",
    dataStatus: "AVAILABLE",
    reason: "لا توجد أحداث مؤثرة.",
  };
}

function blockGate(): EconomicGateDecision {
  return { ...noneGate(), level: "BLOCK", blockNewTrades: true, reason: "حدث عالي التأثير ظهر أثناء الانتظار." };
}

test("لا حدث جديد أثناء الانتظار => يعيد الجلب ويصل READY طبيعياً", async () => {
  let newsCalled = false;
  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => noneGate(),
      refreshTriggerDataIsFresh: async () => true,
      refreshNewsEvaluation: async () => {
        newsCalled = true;
        return { status: "NOT_REQUIRED", application: null };
      },
    },
  );

  assert.equal(result.decision, "READY");
  assert.equal(newsCalled, true);
});

test("حدث اقتصادي ظهر أثناء الانتظار (لم يكن موجوداً وقت WAIT_TRIGGER) => BLOCKED_ECONOMIC_EVENT فوراً", async () => {
  let newsCalled = false;
  let freshnessCalled = false;

  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => blockGate(),
      refreshTriggerDataIsFresh: async () => {
        freshnessCalled = true;
        return true;
      },
      refreshNewsEvaluation: async () => {
        newsCalled = true;
        return { status: "NOT_REQUIRED", application: null };
      },
    },
  );

  assert.equal(result.decision, "BLOCKED_ECONOMIC_EVENT");
  // تحسين الأداء: لا داعي لإهدار استدعاءات على الأخبار/الحداثة لو البوابة تمنع أصلاً
  assert.equal(newsCalled, false, "لا يجب استدعاء تحديث الأخبار لو البوابة تمنع فوراً");
  assert.equal(freshnessCalled, false, "لا يجب استدعاء تحديث الحداثة لو البوابة تمنع فوراً");
});

test("بيانات التقويم أصبحت UNAVAILABLE أثناء الانتظار => WAIT_DATA، بدون استدعاء الأخبار", async () => {
  let newsCalled = false;
  const unavailableGate: EconomicGateDecision = { ...noneGate(), level: "CAUTION", dataStatus: "UNAVAILABLE" };

  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => unavailableGate,
      refreshTriggerDataIsFresh: async () => true,
      refreshNewsEvaluation: async () => {
        newsCalled = true;
        return { status: "NOT_REQUIRED", application: null };
      },
    },
  );

  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(newsCalled, false);
});

test("خبر سلبي جديد وصل أثناء انتظار تأكيد الشمعة => REJECTED_BY_NEWS بالقيم الطازجة", async () => {
  const rejectedApplication: NewsModifierApplication = {
    baseFinalScore: 74,
    adjustedFinalScore: 66,
    appliedAdjustment: -8,
    baseEligible: true,
    eligibleAfterNews: false,
    positiveBoostBlocked: false,
    positionSide: "CALL",
    modifier: {
      sentiment: "NEGATIVE",
      confidence: 0.9,
      scoreAdjustment: -8,
      warnings: [],
      sourceCount: 1,
      classifiedAt: "2026-07-25T14:05:00.000Z",
      expiresAt: "2026-07-25T14:10:00.000Z",
      headlineHash: "fresh-hash",
    },
  };

  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => noneGate(),
      refreshTriggerDataIsFresh: async () => true,
      refreshNewsEvaluation: async () => ({ status: "COMPLETED", application: rejectedApplication }),
    },
  );

  assert.equal(result.decision, "REJECTED_BY_NEWS");
  assert.equal(result.freshInputsUsed.newsEvaluationStatus, "COMPLETED");
});

test("بيانات السعر لم تعد حديثة وقت التأكيد => WAIT_DATA", async () => {
  let newsCalled = false;
  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => noneGate(),
      refreshTriggerDataIsFresh: async () => false,
      refreshNewsEvaluation: async () => {
        newsCalled = true;
        return { status: "NOT_REQUIRED", application: null };
      },
    },
  );

  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(newsCalled, false);
});

test("فشل تحديث التقويم => WAIT_DATA مع خطأ مسجل، دون رمي استثناء", async () => {
  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => {
        throw new Error("Finnhub timeout");
      },
      refreshTriggerDataIsFresh: async () => true,
      refreshNewsEvaluation: async () => ({ status: "NOT_REQUIRED", application: null }),
    },
  );

  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(result.freshInputsUsed.economicGate.dataStatus, "UNAVAILABLE");
  assert.match(result.refreshErrors[0] ?? "", /Finnhub timeout/);
});

test("فشل تحديث حداثة السعر => WAIT_DATA دون تشغيل الأخبار", async () => {
  let newsCalled = false;
  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => noneGate(),
      refreshTriggerDataIsFresh: async () => {
        throw new Error("Tradier timeout");
      },
      refreshNewsEvaluation: async () => {
        newsCalled = true;
        return { status: "NOT_REQUIRED", application: null };
      },
    },
  );

  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(newsCalled, false);
  assert.match(result.refreshErrors[0] ?? "", /Tradier timeout/);
});

test("فشل تحديث الأخبار => WAIT_DATA وNOT_RUN دون رمي استثناء", async () => {
  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => noneGate(),
      refreshTriggerDataIsFresh: async () => true,
      refreshNewsEvaluation: async () => {
        throw new Error("Claude timeout");
      },
    },
  );

  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(result.freshInputsUsed.newsEvaluationStatus, "NOT_RUN");
  assert.match(result.refreshErrors[0] ?? "", /Claude timeout/);
});

test("freshInputsUsed تعكس فعلياً القيم المُستخدمة في القرار (للـlogs)", async () => {
  const result = await reevaluateGatesAtCandleConfirmation(
    { scanStatus: "OPPORTUNITIES_FOUND", triggerBuilt: true },
    {
      refreshEconomicGate: async () => noneGate(),
      refreshTriggerDataIsFresh: async () => true,
      refreshNewsEvaluation: async () => ({ status: "NOT_REQUIRED", application: null }),
    },
  );

  assert.equal(result.freshInputsUsed.economicGate.level, "NONE");
  assert.equal(result.freshInputsUsed.triggerDataIsFresh, true);
  assert.equal(result.freshInputsUsed.newsEvaluationStatus, "NOT_REQUIRED");
});
