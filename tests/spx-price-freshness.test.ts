import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpxPriceSnapshot,
  canBuildSpxwTriggerFromQuote,
} from "../lib/trading/spx-price-freshness";

const now = new Date("2026-07-25T12:00:00.000Z");

test("a recent last trade is eligible for live trigger evaluation", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, close: 6300, trade_date: now.getTime() - 30_000 },
    now,
  );

  assert.equal(snapshot?.tradeDate, "2026-07-25T11:59:30.000Z");
  assert.equal(snapshot?.ageSeconds, 30);
  assert.equal(snapshot?.freshness, "live");
  assert.equal(snapshot?.priceSource, "last");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), true);
});

test("a delayed quote remains available for preparation but cannot trigger", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, trade_date: now.getTime() - 5 * 60_000 },
    now,
  );

  assert.equal(snapshot?.freshness, "delayed");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("a stale quote cannot trigger", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, trade_date: now.getTime() - 30 * 60_000 },
    now,
  );

  assert.equal(snapshot?.freshness, "stale");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("close is preparation-only even when its timestamp is recent", () => {
  const snapshot = buildSpxPriceSnapshot(
    { close: 6300, trade_date: now.getTime() - 10_000 },
    now,
  );

  assert.equal(snapshot?.priceSource, "close");
  assert.equal(snapshot?.freshness, "live");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("a quote without tradeDate has unknown freshness and cannot trigger", () => {
  const snapshot = buildSpxPriceSnapshot({ bid: 6374, ask: 6376 }, now);

  assert.equal(snapshot?.price, 6375);
  assert.equal(snapshot?.tradeDate, null);
  assert.equal(snapshot?.ageSeconds, null);
  assert.equal(snapshot?.freshness, "unknown");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("epoch seconds are normalized before age calculation", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, trade_date: Math.floor((now.getTime() - 45_000) / 1_000) },
    now,
  );

  assert.equal(snapshot?.ageSeconds, 45);
  assert.equal(snapshot?.freshness, "live");
});
