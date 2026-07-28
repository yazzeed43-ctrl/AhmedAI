import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCandleConfirmation,
  type ClosedCandle,
} from "../lib/trading/candle-confirmation-core";

function candle(
  overrides: Partial<ClosedCandle> = {}
): ClosedCandle {
  return {
    startTime: "2026-07-28T13:55:00.000Z",
    endTime: "2026-07-28T14:00:00.000Z",
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    isClosed: true,
    source: "test",
    ...overrides,
  };
}

test("no touch yet stays WAIT_TRIGGER", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "CALL",
      triggerPrice: 110,
      invalidationPrice: 95,
    },
    currentPrice: 105,
    lastClosedCandle: null,
    evaluatedAt: new Date("2026-07-28T14:00:01.000Z"),
  });

  assert.equal(result.state, "WAIT_TRIGGER");
  assert.equal(result.priceTouchedAt, null);
});

test("first touch becomes PRICE_TOUCHED without a later closed candle", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "CALL",
      triggerPrice: 110,
      invalidationPrice: 95,
    },
    currentPrice: 111,
    lastClosedCandle: null,
    evaluatedAt: new Date("2026-07-28T14:00:01.000Z"),
  });

  assert.equal(result.state, "PRICE_TOUCHED");
  assert.equal(
    result.priceTouchedAt,
    "2026-07-28T14:00:01.000Z"
  );
});

test("a closed candle after the touch confirms a CALL above trigger", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "CALL",
      triggerPrice: 110,
      invalidationPrice: 95,
      priceTouchedAt: "2026-07-28T13:50:00.000Z",
    },
    currentPrice: 111,
    lastClosedCandle: candle({ close: 110.5 }),
    evaluatedAt: new Date("2026-07-28T14:00:01.000Z"),
  });

  assert.equal(result.state, "CANDLE_CONFIRMED");
  assert.equal(result.confirmedCandle?.close, 110.5);
});

test("invalidation wins even over a confirming candle", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "CALL",
      triggerPrice: 110,
      invalidationPrice: 95,
      priceTouchedAt: "2026-07-28T13:50:00.000Z",
    },
    currentPrice: 94, // كسر مستوى الإبطال
    lastClosedCandle: candle({ close: 110.5 }),
    evaluatedAt: new Date("2026-07-28T14:00:01.000Z"),
  });

  assert.equal(result.state, "CANCELLED");
});

test("a PUT direction mirrors the CALL logic below the trigger", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "PUT",
      triggerPrice: 90,
      invalidationPrice: 105,
      priceTouchedAt: "2026-07-28T13:50:00.000Z",
    },
    currentPrice: 89,
    lastClosedCandle: candle({ close: 89.5 }),
    evaluatedAt: new Date("2026-07-28T14:00:01.000Z"),
  });

  assert.equal(result.state, "CANDLE_CONFIRMED");
});

test("a stale closed candle from before the touch cannot confirm", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "CALL",
      triggerPrice: 110,
      invalidationPrice: 95,
      priceTouchedAt: "2026-07-28T14:05:00.000Z", // بعد الشمعة
    },
    currentPrice: 111,
    lastClosedCandle: candle({ close: 110.5 }), // تنتهي 14:00
    evaluatedAt: new Date("2026-07-28T14:10:00.000Z"),
  });

  assert.equal(result.state, "WAIT_CANDLE_CLOSE");
  assert.equal(result.confirmedCandle, null);
});

test("state CANCELLED is sticky regardless of current price", () => {
  const result = evaluateCandleConfirmation({
    plan: {
      direction: "CALL",
      triggerPrice: 110,
      invalidationPrice: 95,
      state: "CANCELLED",
      priceTouchedAt: "2026-07-28T13:50:00.000Z",
    },
    currentPrice: 200, // ما يهم، الحالة مثبتة
    lastClosedCandle: null,
    evaluatedAt: new Date("2026-07-28T14:10:00.000Z"),
  });

  assert.equal(result.state, "CANCELLED");
});
