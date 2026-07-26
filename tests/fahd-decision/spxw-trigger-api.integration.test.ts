import test from "node:test";
import assert from "node:assert/strict";
import {
  enforceSpxwTriggerApiDecision,
  selectSubmittedMonitoringPlans,
} from "../../lib/trading/fahd-decision/spxw-trigger-api-decision";
import { executeSpxwTriggerPost } from "../../lib/trading/fahd-decision/spxw-trigger-route-service";

test("POST /api/spxw-trigger blocks a newly appeared economic event after candle confirmation", async () => {
  let newsCalls = 0;
  const result = {
    state: "CANDLE_CONFIRMED",
    scan: { status: "OPPORTUNITIES_FOUND" },
    priceFreshness: { freshness: "live", priceSource: "last" },
    plans: [{
      contractSymbol: "SPXW_TEST",
      direction: "CALL",
      finalScore: 84,
    }],
  };

  const gated = await enforceSpxwTriggerApiDecision(result, {
    refreshEconomicGate: async () => ({
      level: "BLOCK",
      blockNewTrades: true,
      warnExistingPositions: true,
      existingPositionAction: "REDUCE_RISK",
      dataStatus: "AVAILABLE",
      reason: "High-impact event appeared while waiting for candle close",
    }),
    refreshNewsEvaluation: async () => {
      newsCalls += 1;
      return { status: "NOT_REQUIRED", application: null };
    },
  });

  assert.equal(gated.enforcement.decision, "BLOCKED_ECONOMIC_EVENT");
  assert.equal(gated.enforcement.isExecutable, false);
  assert.equal(gated.executableTrigger, null);
  assert.deepEqual(gated.publicResult.plans, []);
  assert.equal(newsCalls, 0);
});

test("POST /api/spxw-trigger continues monitoringPlans and remains backward compatible with plans", () => {
  const monitoringPlans = [{ contractSymbol: "SPXW_MONITORING" }];
  const legacyPlans = [{ contractSymbol: "SPXW_LEGACY" }];

  assert.equal(
    selectSubmittedMonitoringPlans({ monitoringPlans, plans: legacyPlans }),
    monitoringPlans,
  );
  assert.equal(selectSubmittedMonitoringPlans({ plans: legacyPlans }), legacyPlans);
  assert.deepEqual(selectSubmittedMonitoringPlans({}), []);
});

test("SPXW Trigger POST parses monitoringPlans, follows them, and returns the public response contract", async () => {
  const submittedPlan = {
    direction: "CALL" as const,
    triggerPrice: 6400,
    invalidationPrice: 6394,
  };
  let followedPlans: unknown[] | null = null;
  let buildCalls = 0;

  const response = await executeSpxwTriggerPost(
    new Request("http://localhost/api/spxw-trigger", {
      method: "POST",
      body: JSON.stringify({ monitoringPlans: [submittedPlan] }),
      headers: { "Content-Type": "application/json" },
    }),
    {
      build: async () => {
        buildCalls += 1;
        throw new Error("build must not run for monitoring follow-up");
      },
      follow: async (plans) => {
        followedPlans = plans;
        return {
          state: "CANDLE_CONFIRMED",
          scan: { status: "OPPORTUNITIES_FOUND" },
          priceFreshness: { freshness: "live", priceSource: "last" },
          plans,
        };
      },
      refreshEconomicGate: async () => ({
        level: "BLOCK",
        blockNewTrades: true,
        warnExistingPositions: false,
        existingPositionAction: "NONE",
        dataStatus: "AVAILABLE",
        reason: "New high-impact event",
      }),
      refreshNewsEvaluation: async () => {
        throw new Error("news must not run after economic block");
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(buildCalls, 0);
  assert.deepEqual(followedPlans, [submittedPlan]);
  assert.equal(response.body.success, true);
  assert.equal(response.body.decision, "BLOCKED_ECONOMIC_EVENT");
  assert.equal(response.body.trigger, null);
  assert.deepEqual(response.body.monitoringPlans, [submittedPlan]);
  assert.deepEqual((response.body.result as { plans: unknown[] }).plans, []);
});
