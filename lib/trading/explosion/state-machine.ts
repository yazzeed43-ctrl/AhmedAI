import type { ExplosionEngineConfig } from "./config";
import type {
  PostExecutionInput,
  PostExecutionState,
  PreExecutionEvaluation,
  PreExecutionInput,
  TriggerTouchSnapshot,
} from "./types";

export function registerEligibleClosedBar(
  snapshot: TriggerTouchSnapshot,
  candle: PreExecutionInput["candle"],
): TriggerTouchSnapshot {
  if (!candle.closed) return snapshot;
  if (candle.openTime === snapshot.touchedBarTime) return snapshot;
  if (candle.openTime === snapshot.lastEvaluatedBarTime) return snapshot;

  return {
    ...snapshot,
    firstEligibleConfirmationBarTime:
      snapshot.firstEligibleConfirmationBarTime ?? candle.openTime,
    lastEvaluatedBarTime: candle.openTime,
    confirmationBarsEvaluated: snapshot.confirmationBarsEvaluated + 1,
  };
}

function preResult(
  state: PreExecutionEvaluation["state"],
  touchSnapshot: TriggerTouchSnapshot | null,
  events: PreExecutionEvaluation["events"] = [],
): PreExecutionEvaluation {
  return { state, touchSnapshot, events };
}

export function evaluatePreExecutionState(
  input: PreExecutionInput,
  config: ExplosionEngineConfig,
): PreExecutionEvaluation {
  const {
    candle,
    touchSnapshot,
    requiredDataMissing,
    invalidationHit,
    triggerTouched,
    candleClosedBeyondTrigger,
    entryNotExtended,
    breakoutAttemptWasValid,
  } = input;

  if (requiredDataMissing) return preResult("IDLE", touchSnapshot);
  if (invalidationHit) return preResult("CANCELLED", touchSnapshot);

  if (!touchSnapshot) {
    if (!triggerTouched) return preResult("WAIT_TRIGGER", null);

    const recordedTouch: TriggerTouchSnapshot = {
      touchedAt: input.now,
      touchedBarTime: candle.openTime,
      firstEligibleConfirmationBarTime: null,
      lastEvaluatedBarTime: null,
      confirmationBarsEvaluated: 0,
    };

    return preResult("WAIT_CANDLE_CLOSE", recordedTouch, [
      {
        type: "TRIGGER_TOUCHED",
        occurredAt: input.now,
        barTime: candle.openTime,
      },
    ]);
  }

  if (!candle.closed) return preResult("WAIT_CANDLE_CLOSE", touchSnapshot);

  const updatedSnapshot = registerEligibleClosedBar(touchSnapshot, candle);

  // Conservative V1: the touch candle itself can never confirm the setup.
  if (candle.openTime === touchSnapshot.touchedBarTime) {
    return preResult("WAIT_CANDLE_CLOSE", updatedSnapshot);
  }

  // The last eligible bar receives its full price evaluation before expiry.
  if (candleClosedBeyondTrigger) {
    return entryNotExtended
      ? preResult("CANDLE_CONFIRMED", updatedSnapshot)
      : preResult("MISSED_ENTRY", updatedSnapshot);
  }

  if (breakoutAttemptWasValid) {
    return preResult("FAILED_BREAKOUT", updatedSnapshot);
  }

  if (updatedSnapshot.confirmationBarsEvaluated >= config.maxConfirmationBars) {
    return preResult("EXPIRED", updatedSnapshot);
  }

  return preResult("WAIT_CANDLE_CLOSE", updatedSnapshot);
}

export function evaluatePostExecutionState(
  input: PostExecutionInput,
  config: ExplosionEngineConfig,
): PostExecutionState {
  // A single OHLC bar cannot reveal whether stop or target traded first.
  if (config.stopFirstOnAmbiguousBar && input.stopHit) return "STOPPED";
  if (input.target2Hit) return "TARGET2";
  if (input.target1Hit) return "TARGET1";
  if (input.stopHit) return "STOPPED";
  if (input.exhaustionConfirmed) return "EXHAUSTED";
  return "EXPANSION_ACTIVE";
}
