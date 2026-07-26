import type { EconomicGateDecision } from "./economic-calendar-gate";
import type { NewsEvaluationStatus } from "./final-trade-decision";
import { determineFinalTradeDecision } from "./final-trade-decision";
import { enforceExecutableDecision } from "./enforce-executable-decision";
import { reevaluateGatesAtCandleConfirmation } from "./reevaluate-gates-at-candle-confirmation";

export type TriggerApiResult = {
  state?: string;
  plans?: unknown[];
  scan?: { status?: string };
  priceFreshness?: { freshness?: string; priceSource?: string } | null;
};

export type TriggerApiDecisionDeps = {
  refreshEconomicGate: () => Promise<EconomicGateDecision>;
  refreshNewsEvaluation: () => Promise<{
    status: NewsEvaluationStatus;
    application: Parameters<typeof determineFinalTradeDecision>[0]["newsApplication"];
  }>;
};

export function selectSubmittedMonitoringPlans(
  body: Record<string, unknown>,
): unknown[] {
  if (Array.isArray(body.monitoringPlans)) return body.monitoringPlans;
  return Array.isArray(body.plans) ? body.plans : [];
}

export async function enforceSpxwTriggerApiDecision<T extends TriggerApiResult>(
  result: T,
  deps: TriggerApiDecisionDeps,
) {
  const scanStatus = String(result.scan?.status ?? "OPPORTUNITIES_FOUND");
  const triggerBuilt = Array.isArray(result.plans) && result.plans.length > 0;
  const triggerDataIsFresh =
    result.priceFreshness?.freshness === "live" &&
    result.priceFreshness?.priceSource !== "close";

  let decision;
  let refreshErrors: string[] = [];

  if (result.state === "CANDLE_CONFIRMED") {
    const reevaluated = await reevaluateGatesAtCandleConfirmation(
      { scanStatus, triggerBuilt },
      {
        refreshEconomicGate: deps.refreshEconomicGate,
        refreshTriggerDataIsFresh: async () => triggerDataIsFresh,
        refreshNewsEvaluation: deps.refreshNewsEvaluation,
      },
    );
    decision = reevaluated.decision;
    refreshErrors = reevaluated.refreshErrors;
  } else {
    let economicGate: EconomicGateDecision;
    try {
      economicGate = await deps.refreshEconomicGate();
    } catch (error) {
      economicGate = {
        level: "CAUTION",
        blockNewTrades: true,
        warnExistingPositions: false,
        existingPositionAction: "NONE",
        dataStatus: "UNAVAILABLE",
        reason: error instanceof Error ? error.message : "Economic gate refresh failed",
      };
      refreshErrors = ["ECONOMIC_GATE_REFRESH_FAILED"];
    }

    decision = determineFinalTradeDecision({
      scanStatus,
      economicGate,
      triggerDataIsFresh,
      candleState: String(result.state ?? "WAIT_TRIGGER"),
      triggerBuilt,
      newsEvaluationStatus: "NOT_RUN",
      newsApplication: null,
    });
  }

  const enforcement = enforceExecutableDecision(decision, {
    trigger: triggerBuilt ? result : null,
  });

  return {
    enforcement,
    refreshErrors,
    executableTrigger: enforcement.executableTrigger,
    publicResult: enforcement.isExecutable
      ? result
      : { ...result, plans: [] },
  };
}
