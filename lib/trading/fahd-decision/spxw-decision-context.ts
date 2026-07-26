import type { ClassifyFn } from "./news-classifier";
import type { RawHeadline } from "./news-modifier-types";
import {
  fetchEconomicCalendarForGate,
  buildEconomicGateWithPositionWarning,
} from "./fahd-economic-gate-integration";
import { getNewsModifierDecision } from "./get-news-modifier-decision";
import { applyNewsModifier } from "./apply-news-modifier";
import {
  determineFinalTradeDecision,
  type NewsEvaluationStatus,
} from "./final-trade-decision";
import { enforceExecutableDecision } from "./enforce-executable-decision";

export type SpxwDecisionContextDeps = {
  finnhubKey?: string;
  finnhubBase: string;
  fetchWithTimeout: (
    url: string,
    options: RequestInit,
    timeoutMs: number,
  ) => Promise<Response>;
  formatDate: (date: Date) => string;
  getPositions: () => Promise<unknown>;
  fetchGeneralHeadlines: () => Promise<RawHeadline[]>;
  classifyFn: ClassifyFn;
  buildTrigger: () => Promise<any>;
};

export async function buildSpxwDecisionContext(
  scan: any,
  deps: SpxwDecisionContextDeps,
) {
  const calendarData = deps.finnhubKey
    ? await fetchEconomicCalendarForGate(deps.finnhubKey, {
        fetchWithTimeout: deps.fetchWithTimeout,
        formatDate: deps.formatDate,
        finnhubBase: deps.finnhubBase,
      })
    : {
        events: [],
        dataStatus: "UNAVAILABLE" as const,
        fetchedAt: new Date().toISOString(),
      };

  const economicGate = await buildEconomicGateWithPositionWarning(calendarData, {
    getPositions: deps.getPositions,
  });

  const trigger =
    scan?.status === "OPPORTUNITIES_FOUND" &&
    Array.isArray(scan?.opportunities) &&
    scan.opportunities.length > 0 &&
    !economicGate.blockNewTrades &&
    economicGate.dataStatus === "AVAILABLE"
      ? await deps.buildTrigger()
      : null;

  const topOpportunity = Array.isArray(scan?.opportunities)
    ? scan.opportunities[0] ?? null
    : null;

  const triggerBuilt = Boolean(
    trigger && Array.isArray(trigger.plans) && trigger.plans.length > 0,
  );
  const candleState = String(trigger?.state ?? "WAIT_TRIGGER");
  const triggerDataIsFresh =
    triggerBuilt && candleState !== "WAIT_FRESH_PRICE";
  const shouldEvaluateNews =
    triggerBuilt &&
    triggerDataIsFresh &&
    candleState === "CANDLE_CONFIRMED" &&
    !economicGate.blockNewTrades &&
    economicGate.dataStatus === "AVAILABLE";

  let newsEvaluationStatus: NewsEvaluationStatus = shouldEvaluateNews
    ? "NOT_REQUIRED"
    : "NOT_RUN";
  let newsApplication = null;
  let headlines: RawHeadline[] = [];

  if (topOpportunity && shouldEvaluateNews) {
    try {
      headlines = await deps.fetchGeneralHeadlines();
    } catch {
      newsEvaluationStatus = "NOT_RUN";
      headlines = [];
    }

    if (headlines.length > 0) {
      const modifier = await getNewsModifierDecision(
        {
          symbol: "SPXW",
          headlines,
          category: "breaking",
        },
        deps.classifyFn,
      );

      newsEvaluationStatus = modifier.classificationSucceeded
        ? "COMPLETED"
        : "FAILED_SAFE";

      newsApplication = applyNewsModifier(topOpportunity.finalScore, modifier, {
        positionSide:
          topOpportunity.direction === "PUT" ? "PUT" : "CALL",
        minimumFinalScore: 72,
      });
    }
  }

  const finalDecision = determineFinalTradeDecision({
    scanStatus: String(scan?.status ?? "WAIT"),
    economicGate,
    triggerDataIsFresh,
    candleState,
    triggerBuilt,
    newsEvaluationStatus,
    newsApplication,
  });
  const enforcement = enforceExecutableDecision(finalDecision, {
    trigger: triggerBuilt ? trigger : null,
  });

  return {
    economicCalendar: calendarData,
    economicGate,
    trigger: enforcement.executableTrigger,
    monitoringPlans:
      enforcement.isExecutable || !Array.isArray(trigger?.plans)
        ? []
        : trigger.plans,
    headlinesUsed: headlines,
    newsEvaluationStatus,
    newsApplication,
    finalDecision: enforcement.decision,
    enforcement,
  };
}
