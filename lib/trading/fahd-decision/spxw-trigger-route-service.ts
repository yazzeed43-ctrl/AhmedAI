import type { EconomicGateDecision } from "./economic-calendar-gate";
import type { NewsEvaluationStatus } from "./final-trade-decision";
import { enforceSpxwTriggerApiDecision } from "./spxw-trigger-api-decision";
import { selectSubmittedMonitoringPlans } from "./spxw-trigger-api-decision";

type FixedTriggerState = {
  direction: "CALL" | "PUT";
  triggerPrice: number;
  invalidationPrice: number;
  [key: string]: unknown;
};

export type SpxwTriggerRouteServiceDeps = {
  build: (config: Record<string, unknown>) => Promise<any>;
  follow: (plans: FixedTriggerState[]) => Promise<any>;
  refreshEconomicGate: () => Promise<EconomicGateDecision>;
  refreshNewsEvaluation: (result: any) => Promise<{
    status: NewsEvaluationStatus;
    application: any;
  }>;
};

function validPlan(plan: unknown): plan is FixedTriggerState {
  return Boolean(
    plan &&
      typeof plan === "object" &&
      (((plan as FixedTriggerState).direction === "CALL") ||
        (plan as FixedTriggerState).direction === "PUT") &&
      Number.isFinite((plan as FixedTriggerState).triggerPrice) &&
      Number.isFinite((plan as FixedTriggerState).invalidationPrice),
  );
}

export async function executeSpxwTriggerPost(
  request: Pick<Request, "json">,
  deps: SpxwTriggerRouteServiceDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const parsed = await request.json();
    const input =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    const followUpPlans = selectSubmittedMonitoringPlans(input).filter(validPlan);

    const result =
      followUpPlans.length > 0
        ? await deps.follow(followUpPlans)
        : await deps.build({
            maxResults:
              typeof input.maxResults === "number" ? input.maxResults : 2,
            confirmationBufferPoints:
              typeof input.confirmationBufferPoints === "number"
                ? input.confirmationBufferPoints
                : 1.5,
            stopBufferPoints:
              typeof input.stopBufferPoints === "number"
                ? input.stopBufferPoints
                : 6,
            target1Points:
              typeof input.target1Points === "number" ? input.target1Points : 8,
            target2Points:
              typeof input.target2Points === "number" ? input.target2Points : 15,
          });

    const gated = await enforceSpxwTriggerApiDecision(result, {
      refreshEconomicGate: deps.refreshEconomicGate,
      refreshNewsEvaluation: () => deps.refreshNewsEvaluation(result),
    });

    return {
      status: 200,
      body: {
        success: true,
        result: gated.publicResult,
        decision: gated.enforcement.decision,
        trigger: gated.executableTrigger,
        monitoringPlans: gated.enforcement.isExecutable
          ? []
          : Array.isArray(result.plans)
            ? result.plans
            : [],
        userMessage: gated.enforcement.userMessage,
        invariantViolation: gated.enforcement.invariantViolation,
        refreshErrors: gated.refreshErrors,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        success: false,
        error: "SPXW_TRIGGER_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}
