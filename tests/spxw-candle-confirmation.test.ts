import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSpxwCandleConfirmation,
  type ClosedFiveMinuteCandle,
} from "../lib/trading/spxw-candle-confirmation";

const evaluatedAt = new Date("2026-07-25T14:40:30.000Z");
const callPlan = {
  direction: "CALL" as const,
  triggerPrice: 6380,
  invalidationPrice: 6374,
};

function candle(
  close: number,
  startTime = "2026-07-25T14:35:00.000Z",
): ClosedFiveMinuteCandle {
  const start = new Date(startTime);
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 5 * 60_000).toISOString(),
    open: 6379,
    high: 6382,
    low: 6378,
    close,
    isClosed: true,
    source: "test",
  };
}

test("waits for trigger before price is touched", () => {
  const result = evaluateSpxwCandleConfirmation({
    plan: callPlan,
    currentSpxPrice: 6378,
    lastClosedCandle: candle(6381),
    evaluatedAt,
  });

  assert.equal(result.state, "WAIT_TRIGGER");
  assert.equal(result.priceTouchedAt, null);
});

test("first touch becomes PRICE_TOUCHED without using an older candle", () => {
  const result = evaluateSpxwCandleConfirmation({
    plan: callPlan,
    currentSpxPrice: 6381,
    lastClosedCandle: candle(6381),
    evaluatedAt,
  });

  assert.equal(result.state, "PRICE_TOUCHED");
  assert.equal(result.priceTouchedAt, evaluatedAt.toISOString());
  assert.equal(result.confirmedCandle, null);
});

test("a prior touch waits for a later candle close", () => {
  const result = evaluateSpxwCandleConfirmation({
    plan: {
      ...callPlan,
      state: "PRICE_TOUCHED",
      priceTouchedAt: "2026-07-25T14:39:00.000Z",
    },
    currentSpxPrice: 6381,
    lastClosedCandle: candle(6381, "2026-07-25T14:30:00.000Z"),
    evaluatedAt,
  });

  assert.equal(result.state, "WAIT_CANDLE_CLOSE");
});

test("only a closed candle after the touch can confirm a call", () => {
  const result = evaluateSpxwCandleConfirmation({
    plan: {
      ...callPlan,
      state: "WAIT_CANDLE_CLOSE",
      priceTouchedAt: "2026-07-25T14:34:30.000Z",
    },
    currentSpxPrice: 6381,
    lastClosedCandle: candle(6380.5),
    evaluatedAt,
  });

  assert.equal(result.state, "CANDLE_CONFIRMED");
  assert.equal(result.confirmedCandle?.close, 6380.5);
});

test("put confirmation requires a close at or below its fixed trigger", () => {
  const result = evaluateSpxwCandleConfirmation({
    plan: {
      direction: "PUT",
      triggerPrice: 6370,
      invalidationPrice: 6376,
      state: "WAIT_CANDLE_CLOSE",
      priceTouchedAt: "2026-07-25T14:34:30.000Z",
    },
    currentSpxPrice: 6369,
    lastClosedCandle: candle(6369.5),
    evaluatedAt,
  });

  assert.equal(result.state, "CANDLE_CONFIRMED");
});

test("invalidation wins over a confirming candle", () => {
  const result = evaluateSpxwCandleConfirmation({
    plan: {
      ...callPlan,
      state: "WAIT_CANDLE_CLOSE",
      priceTouchedAt: "2026-07-25T14:34:30.000Z",
    },
    currentSpxPrice: 6373,
    lastClosedCandle: candle(6381),
    evaluatedAt,
  });

  assert.equal(result.state, "CANCELLED");
  assert.equal(result.confirmedCandle, null);
});

test("evaluation never recalculates fixed trigger levels", () => {
  const plan = {
    ...callPlan,
    state: "PRICE_TOUCHED" as const,
    priceTouchedAt: "2026-07-25T14:39:00.000Z",
  };

  evaluateSpxwCandleConfirmation({
    plan,
    currentSpxPrice: 6400,
    lastClosedCandle: null,
    evaluatedAt,
  });

  assert.equal(plan.triggerPrice, 6380);
  assert.equal(plan.invalidationPrice, 6374);
});
