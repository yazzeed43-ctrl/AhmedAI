import test from "node:test";
import assert from "node:assert/strict";
import { enforceExecutableDecision } from "../../lib/trading/fahd-decision/enforce-executable-decision";
import type { FinalTradeDecision } from "../../lib/trading/fahd-decision/final-trade-decision";

const ALL_DECISIONS: FinalTradeDecision[] = [
  "READY",
  "BLOCKED_ECONOMIC_EVENT",
  "WAIT_DATA",
  "NO_OPPORTUNITY",
  "WAIT_TRIGGER",
  "WAIT_CANDLE_CLOSE",
  "CANCELLED",
  "REJECTED_BY_NEWS",
];

test("READY فقط => isExecutable=true وtrigger يمر كما هو", () => {
  const result = enforceExecutableDecision("READY", { trigger: { symbol: "SPXW", side: "CALL" } });
  assert.equal(result.isExecutable, true);
  assert.deepEqual(result.executableTrigger, { symbol: "SPXW", side: "CALL" });
});

test("كل حالة غير READY => executableTrigger يُصفَّر لـnull حتى لو مُرِّر trigger صالح", () => {
  const nonReadyDecisions = ALL_DECISIONS.filter((d) => d !== "READY");
  for (const decision of nonReadyDecisions) {
    const result = enforceExecutableDecision(decision, { trigger: { symbol: "SPXW", side: "CALL" } });
    assert.equal(result.isExecutable, false, `${decision} يجب أن يكون isExecutable=false`);
    assert.equal(result.executableTrigger, null, `${decision} يجب أن يصفّر trigger`);
  }
});

test("كل حالة لها رسالة مستخدم عربية فريدة وغير فارغة", () => {
  for (const decision of ALL_DECISIONS) {
    const result = enforceExecutableDecision(decision, { trigger: null });
    assert.ok(result.userMessage.length > 0, `${decision} بلا رسالة`);
  }
});

test("trigger=null مع decision=READY => غير قابل للتنفيذ ولا يعرض رسالة جاهزية", () => {
  const result = enforceExecutableDecision("READY", { trigger: null });
  assert.equal(result.isExecutable, false);
  assert.equal(result.executableTrigger, null);
  assert.equal(result.decision, "WAIT_TRIGGER");
  assert.equal(result.invariantViolation, "READY_WITHOUT_TRIGGER");
  assert.match(result.userMessage, /لم تصدر توصية دخول/);
});
