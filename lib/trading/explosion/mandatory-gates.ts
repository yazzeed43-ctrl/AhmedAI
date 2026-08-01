import type { ExplosionEngineConfig } from "./config";
import type {
  ExplosionDecision,
  MandatoryGateInput,
  MandatoryGateResult,
} from "./types";

const TERMINAL_DECISIONS: Partial<Record<MandatoryGateInput["state"], ExplosionDecision>> = {
  CANCELLED: "CANCELLED",
  FAILED_BREAKOUT: "FAILED_BREAKOUT",
  MISSED_ENTRY: "MISSED_ENTRY",
  EXPIRED: "EXPIRED",
  STOPPED: "STOPPED",
  EXHAUSTED: "EXHAUSTED",
  TARGET1: "TARGET1",
  TARGET2: "TARGET2",
};

export function evaluateMandatoryGates(
  input: MandatoryGateInput,
  config: ExplosionEngineConfig,
): MandatoryGateResult {
  const result = {
    directionResolved: input.direction !== "NEUTRAL",
    scorePassed:
      input.selectedExplosionScore !== null &&
      input.selectedExplosionScore >= config.executableScore,
    contractQualityPassed:
      input.contractQuality !== null &&
      input.contractQuality >= config.minimumContractQuality,
    candleClosedBeyondTrigger: input.state === "CANDLE_CONFIRMED",
    breakoutVolumeConfirmed: input.breakoutVolumeConfirmed,
    underlyingDataFresh: input.underlyingDataStatus === "FRESH",
    contractDataFresh: input.contractDataStatus === "FRESH",
    contractLiquid: input.contractLiquid,
    economicDataComplete: input.economicCalendarStatus === "COMPLETE",
    economicGateAllowsEntry: input.economicGateAllowsEntry,
    noInvalidation: input.noInvalidation,
    notExpired: !input.signalExpired,
    entryNotExtended: input.entryNotExtended,
  };

  return {
    ...result,
    allPassed: Object.values(result).every(Boolean),
  };
}

export function deriveExplosionDecision(
  input: MandatoryGateInput,
  gates: MandatoryGateResult,
): ExplosionDecision {
  const terminal = TERMINAL_DECISIONS[input.state];
  if (terminal) return terminal;

  if (
    input.underlyingDataStatus !== "FRESH" ||
    input.contractDataStatus !== "FRESH" ||
    input.economicCalendarStatus !== "COMPLETE"
  ) {
    return "WAIT_DATA";
  }

  if (!gates.directionResolved) return "NEUTRAL";
  if (input.state === "WAIT_CANDLE_CLOSE") return "WAIT_CANDLE_CLOSE";
  if (input.state === "WAIT_TRIGGER") return "WAIT_TRIGGER";

  if (input.state === "CANDLE_CONFIRMED") {
    if (input.contractQuality === null) return "WAIT_DATA";
    if (!gates.contractQualityPassed || !gates.contractLiquid) return "WAIT_CONTRACT";
    return gates.allPassed ? "EXECUTABLE" : "MONITOR";
  }

  if (input.selectedExplosionScore !== null) return "MONITOR";

  return "NEUTRAL";
}

export function gateBlockers(gates: MandatoryGateResult): string[] {
  const labels: Array<[keyof MandatoryGateResult, string]> = [
    ["directionResolved", "Direction is not resolved"],
    ["scorePassed", "Explosion score is below the executable threshold"],
    ["contractQualityPassed", "Contract quality is below the required threshold"],
    ["candleClosedBeyondTrigger", "A closed candle has not confirmed the trigger"],
    ["breakoutVolumeConfirmed", "Breakout volume is not confirmed"],
    ["underlyingDataFresh", "Underlying data is not fresh"],
    ["contractDataFresh", "Contract data is not fresh"],
    ["contractLiquid", "The option contract is not liquid"],
    ["economicDataComplete", "Economic calendar data is incomplete"],
    ["economicGateAllowsEntry", "The economic gate blocks entry"],
    ["noInvalidation", "The setup has been invalidated"],
    ["notExpired", "The setup has expired"],
    ["entryNotExtended", "The entry is extended beyond the anti-chase limit"],
  ];

  return labels
    .filter(([key]) => key !== "allPassed" && !gates[key])
    .map(([, label]) => label);
}
