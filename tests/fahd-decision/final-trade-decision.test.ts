import test from "node:test";
import assert from "node:assert/strict";
import {
  determineFinalTradeDecision,
  type FinalTradeDecisionInput,
} from "../../lib/trading/fahd-decision/final-trade-decision";
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
  return { ...noneGate(), level: "BLOCK", blockNewTrades: true, reason: "حدث عالي التأثير قريب." };
}

function baseInput(overrides: Partial<FinalTradeDecisionInput> = {}): FinalTradeDecisionInput {
  return {
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate: noneGate(),
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "NOT_REQUIRED",
    newsApplication: null,
    ...overrides,
  };
}

function eligibleNewsApplication(): NewsModifierApplication {
  return {
    baseFinalScore: 74,
    adjustedFinalScore: 78,
    appliedAdjustment: 4,
    baseEligible: true,
    eligibleAfterNews: true,
    positiveBoostBlocked: false,
    positionSide: "CALL",
    modifier: {
      sentiment: "POSITIVE",
      confidence: 0.9,
      scoreAdjustment: 4,
      warnings: [],
      sourceCount: 2,
      classifiedAt: "2026-07-25T14:00:00.000Z",
      expiresAt: "2026-07-25T14:10:00.000Z",
      headlineHash: "x",
    },
  };
}

// ============================================================
// scan / economicGate
// ============================================================

test("scan لم يجد فرص (NO_OPPORTUNITIES) => NO_OPPORTUNITY (وليس WAIT_DATA بعد الإصلاح)", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ scanStatus: "NO_OPPORTUNITIES" })), "NO_OPPORTUNITY");
});

test("economicGate يمنع => BLOCKED_ECONOMIC_EVENT حتى مع خبر إيجابي جاهز", () => {
  const result = determineFinalTradeDecision(
    baseInput({
      economicGate: blockGate(),
      newsEvaluationStatus: "COMPLETED",
      newsApplication: eligibleNewsApplication(),
    }),
  );
  assert.equal(result, "BLOCKED_ECONOMIC_EVENT");
});

test("بيانات غير حديثة => WAIT_DATA", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ triggerDataIsFresh: false })), "WAIT_DATA");
});

// ============================================================
// NO_OPPORTUNITY vs WAIT_DATA
// ============================================================

test("scanStatus = NO_MATCH => NO_OPPORTUNITY (نتيجة شرعية، ليست مشكلة بيانات)", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ scanStatus: "NO_MATCH" })), "NO_OPPORTUNITY");
});

test("scanStatus = NO_OPPORTUNITY صراحة => NO_OPPORTUNITY", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ scanStatus: "NO_OPPORTUNITY" })), "NO_OPPORTUNITY");
});

test("scanStatus بقيمة غير معروفة (مثل DATA_UNAVAILABLE) => WAIT_DATA، لا NO_OPPORTUNITY", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ scanStatus: "DATA_UNAVAILABLE" })), "WAIT_DATA");
});

// ============================================================
// economicGate.dataStatus غير AVAILABLE => WAIT_DATA
// ============================================================

test("economicGate.dataStatus = UNAVAILABLE (حتى مع level=CAUTION فقط) => WAIT_DATA وليس READY", () => {
  const cautionGate: EconomicGateDecision = {
    level: "CAUTION",
    blockNewTrades: false,
    warnExistingPositions: false,
    existingPositionAction: "NONE",
    dataStatus: "UNAVAILABLE",
    reason: "تعذر التحقق من التقويم الاقتصادي حالياً.",
  };
  const result = determineFinalTradeDecision(baseInput({ economicGate: cautionGate }));
  assert.equal(result, "WAIT_DATA");
});

test("economicGate.dataStatus = PARTIAL => WAIT_DATA", () => {
  const partialGate: EconomicGateDecision = {
    level: "CAUTION",
    blockNewTrades: false,
    warnExistingPositions: false,
    existingPositionAction: "NONE",
    dataStatus: "PARTIAL",
    reason: "بيانات التقويم الاقتصادي غير مكتملة.",
  };
  const result = determineFinalTradeDecision(baseInput({ economicGate: partialGate }));
  assert.equal(result, "WAIT_DATA");
});

test("economicGate.dataStatus = AVAILABLE مع level=NONE => يستمر طبيعياً", () => {
  const result = determineFinalTradeDecision(baseInput());
  assert.equal(result, "READY");
});

test("economicGate يمنع (BLOCK) رغم أن dataStatus=PARTIAL => BLOCKED_ECONOMIC_EVENT يسبق فحص dataStatus", () => {
  const blockWithPartialData: EconomicGateDecision = {
    level: "BLOCK",
    blockNewTrades: true,
    warnExistingPositions: false,
    existingPositionAction: "NONE",
    dataStatus: "PARTIAL",
    reason: "حدث عالي التأثير مؤكد رغم نقص بعض البيانات.",
  };
  const result = determineFinalTradeDecision(baseInput({ economicGate: blockWithPartialData }));
  assert.equal(result, "BLOCKED_ECONOMIC_EVENT");
});

// ============================================================
// حالات آلة الشمعة — مُفسَّرة صراحة
// ============================================================

test("candleState = WAIT_TRIGGER => WAIT_TRIGGER (وليس WAIT_CANDLE_CLOSE)", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ candleState: "WAIT_TRIGGER" })), "WAIT_TRIGGER");
});

test("candleState = PRICE_TOUCHED => WAIT_CANDLE_CLOSE", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ candleState: "PRICE_TOUCHED" })), "WAIT_CANDLE_CLOSE");
});

test("candleState = WAIT_CANDLE_CLOSE => WAIT_CANDLE_CLOSE", () => {
  assert.equal(
    determineFinalTradeDecision(baseInput({ candleState: "WAIT_CANDLE_CLOSE" })),
    "WAIT_CANDLE_CLOSE",
  );
});

test("candleState = CANCELLED => CANCELLED (حالة مستقلة، لا تُضغَط ضمن الانتظار)", () => {
  assert.equal(determineFinalTradeDecision(baseInput({ candleState: "CANCELLED" })), "CANCELLED");
});

test("candleState = CANDLE_CONFIRMED لكن triggerBuilt=false => WAIT_TRIGGER", () => {
  assert.equal(
    determineFinalTradeDecision(baseInput({ candleState: "CANDLE_CONFIRMED", triggerBuilt: false })),
    "WAIT_TRIGGER",
  );
});

test("candleState بقيمة غير معروفة => WAIT_DATA، لا نفترض الجاهزية", () => {
  assert.equal(
    determineFinalTradeDecision(baseInput({ candleState: "SOME_UNKNOWN_STATE" })),
    "WAIT_DATA",
  );
});

// ============================================================
// newsEvaluationStatus
// ============================================================

test("newsEvaluationStatus=NOT_REQUIRED مع newsApplication=null => READY", () => {
  assert.equal(
    determineFinalTradeDecision(baseInput({ newsEvaluationStatus: "NOT_REQUIRED", newsApplication: null })),
    "READY",
  );
});

test("newsEvaluationStatus=NOT_RUN => WAIT_DATA، ليس READY", () => {
  assert.equal(
    determineFinalTradeDecision(baseInput({ newsEvaluationStatus: "NOT_RUN", newsApplication: null })),
    "WAIT_DATA",
  );
});

test("newsEvaluationStatus=COMPLETED مع newsApplication=null (تناقض داخلي) => WAIT_DATA", () => {
  assert.equal(
    determineFinalTradeDecision(baseInput({ newsEvaluationStatus: "COMPLETED", newsApplication: null })),
    "WAIT_DATA",
  );
});

test("newsEvaluationStatus=COMPLETED مع eligibleAfterNews=false => REJECTED_BY_NEWS", () => {
  const rejected: NewsModifierApplication = {
    ...eligibleNewsApplication(),
    adjustedFinalScore: 66,
    eligibleAfterNews: false,
  };
  assert.equal(
    determineFinalTradeDecision(
      baseInput({ newsEvaluationStatus: "COMPLETED", newsApplication: rejected }),
    ),
    "REJECTED_BY_NEWS",
  );
});

test("newsEvaluationStatus=COMPLETED مع eligibleAfterNews=true => READY", () => {
  assert.equal(
    determineFinalTradeDecision(
      baseInput({ newsEvaluationStatus: "COMPLETED", newsApplication: eligibleNewsApplication() }),
    ),
    "READY",
  );
});

test("newsEvaluationStatus=FAILED_SAFE مع eligibleAfterNews=true => READY", () => {
  const fallback: NewsModifierApplication = {
    baseFinalScore: 74,
    adjustedFinalScore: 74,
    appliedAdjustment: 0,
    baseEligible: true,
    eligibleAfterNews: true,
    positiveBoostBlocked: false,
    positionSide: "CALL",
    modifier: {
      sentiment: "NEUTRAL",
      confidence: 0,
      scoreAdjustment: 0,
      warnings: ["تعذر تصنيف أثر الأخبار الحالية."],
      sourceCount: 2,
      classifiedAt: "2026-07-25T14:00:00.000Z",
      expiresAt: "2026-07-25T14:10:00.000Z",
      headlineHash: "z",
    },
  };
  assert.equal(
    determineFinalTradeDecision(
      baseInput({ newsEvaluationStatus: "FAILED_SAFE", newsApplication: fallback }),
    ),
    "READY",
  );
});
