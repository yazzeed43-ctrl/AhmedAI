import test from "node:test";
import assert from "node:assert/strict";
import { buildSpxwDecisionContext } from "../../lib/trading/fahd-decision/spxw-decision-context";

test("fahd-chat treats a Finnhub news fetch failure as NOT_RUN and WAIT_DATA", async () => {
  const fixedPlan = {
    direction: "CALL",
    triggerPrice: 6400,
    invalidationPrice: 6394,
  };

  const context = await buildSpxwDecisionContext(
    {
      status: "OPPORTUNITIES_FOUND",
      opportunities: [{ direction: "CALL", finalScore: 82 }],
    },
    {
      finnhubKey: "test-key",
      finnhubBase: "https://example.test",
      fetchWithTimeout: async () =>
        new Response(JSON.stringify({ economicCalendar: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      formatDate: (date) => date.toISOString().slice(0, 10),
      getPositions: async () => [],
      fetchGeneralHeadlines: async () => {
        throw new Error("Finnhub unavailable");
      },
      classifyFn: async () => {
        throw new Error("classifier must not run without headlines");
      },
      buildTrigger: async () => ({
        state: "CANDLE_CONFIRMED",
        plans: [fixedPlan],
      }),
    },
  );

  assert.equal(context.newsEvaluationStatus, "NOT_RUN");
  assert.equal(context.finalDecision, "WAIT_DATA");
  assert.equal(context.trigger, null);
  assert.deepEqual(context.monitoringPlans, [fixedPlan]);
});
