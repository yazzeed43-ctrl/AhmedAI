export type SpxwCandleConfirmationState =
  | "WAIT_TRIGGER"
  | "PRICE_TOUCHED"
  | "WAIT_CANDLE_CLOSE"
  | "CANDLE_CONFIRMED"
  | "CANCELLED";

export interface ClosedFiveMinuteCandle {
  startTime: string;
  endTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: true;
  source: string;
}

export interface FixedTriggerState {
  direction: "CALL" | "PUT";
  triggerPrice: number;
  invalidationPrice: number;
  state?: SpxwCandleConfirmationState;
  priceTouchedAt?: string | null;
}

export interface CandleConfirmationEvaluation {
  state: SpxwCandleConfirmationState;
  priceTouchedAt: string | null;
  confirmedCandle: ClosedFiveMinuteCandle | null;
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateSpxwCandleConfirmation(input: {
  plan: FixedTriggerState;
  currentSpxPrice: number;
  lastClosedCandle: ClosedFiveMinuteCandle | null;
  evaluatedAt?: Date;
}): CandleConfirmationEvaluation {
  const { plan, currentSpxPrice, lastClosedCandle } = input;
  const evaluatedAt = input.evaluatedAt ?? new Date();

  const cancelled =
    plan.direction === "CALL"
      ? currentSpxPrice <= plan.invalidationPrice
      : currentSpxPrice >= plan.invalidationPrice;

  if (cancelled || plan.state === "CANCELLED") {
    return {
      state: "CANCELLED",
      priceTouchedAt: plan.priceTouchedAt ?? null,
      confirmedCandle: null,
    };
  }

  if (plan.state === "CANDLE_CONFIRMED") {
    return {
      state: "CANDLE_CONFIRMED",
      priceTouchedAt: plan.priceTouchedAt ?? null,
      confirmedCandle: lastClosedCandle,
    };
  }

  const touchedNow =
    plan.direction === "CALL"
      ? currentSpxPrice >= plan.triggerPrice
      : currentSpxPrice <= plan.triggerPrice;
  const previousTouch = validDate(plan.priceTouchedAt);
  const priceTouchedAt = previousTouch ?? (touchedNow ? evaluatedAt : null);

  if (!priceTouchedAt) {
    return {
      state: "WAIT_TRIGGER",
      priceTouchedAt: null,
      confirmedCandle: null,
    };
  }

  const candleEnd = validDate(lastClosedCandle?.endTime);
  const isEligibleClosedCandle = Boolean(
    lastClosedCandle?.isClosed &&
      candleEnd &&
      candleEnd.getTime() <= evaluatedAt.getTime() &&
      candleEnd.getTime() > priceTouchedAt.getTime(),
  );
  const candleConfirmed =
    isEligibleClosedCandle && lastClosedCandle
      ? plan.direction === "CALL"
        ? lastClosedCandle.close >= plan.triggerPrice
        : lastClosedCandle.close <= plan.triggerPrice
      : false;

  if (candleConfirmed) {
    return {
      state: "CANDLE_CONFIRMED",
      priceTouchedAt: priceTouchedAt.toISOString(),
      confirmedCandle: lastClosedCandle,
    };
  }

  return {
    state: previousTouch ? "WAIT_CANDLE_CLOSE" : "PRICE_TOUCHED",
    priceTouchedAt: priceTouchedAt.toISOString(),
    confirmedCandle: null,
  };
}
