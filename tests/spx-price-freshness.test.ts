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
  assert.equal(snapshot?.timestampSource, "trade_date");
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
  assert.equal(snapshot?.timestampSource, null);
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

test("a materially future trade timestamp is never treated as live", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, trade_date: now.getTime() + 60_000 },
    now,
  );

  assert.equal(snapshot?.tradeDate, "2026-07-25T12:01:00.000Z");
  assert.equal(snapshot?.ageSeconds, null);
  assert.equal(snapshot?.freshness, "unknown");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("minor provider clock skew is tolerated without producing a negative age", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, trade_date: now.getTime() + 4_000 },
    now,
  );

  assert.equal(snapshot?.ageSeconds, 0);
  assert.equal(snapshot?.freshness, "live");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), true);
});

test("midpoint freshness uses the older of bid and ask timestamps", () => {
  const snapshot = buildSpxPriceSnapshot(
    {
      bid: 6374,
      ask: 6376,
      bid_date: now.getTime() - 5 * 60_000,
      ask_date: now.getTime() - 10_000,
      trade_date: now.getTime() - 5_000,
    },
    now,
  );

  assert.equal(snapshot?.price, 6375);
  assert.equal(snapshot?.priceSource, "midpoint");
  assert.equal(snapshot?.timestampSource, "bid_ask_dates");
  assert.equal(snapshot?.tradeDate, "2026-07-25T11:55:00.000Z");
  assert.equal(snapshot?.ageSeconds, 300);
  assert.equal(snapshot?.freshness, "delayed");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("midpoint without both side timestamps fails safe as unknown", () => {
  const snapshot = buildSpxPriceSnapshot(
    {
      bid: 6374,
      ask: 6376,
      bid_date: now.getTime() - 10_000,
      trade_date: now.getTime() - 5_000,
    },
    now,
  );

  assert.equal(snapshot?.priceSource, "midpoint");
  assert.equal(snapshot?.tradeDate, null);
  assert.equal(snapshot?.ageSeconds, null);
  assert.equal(snapshot?.freshness, "unknown");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("a date-only value cannot claim precise quote freshness", () => {
  const snapshot = buildSpxPriceSnapshot(
    { last: 6375.25, trade_date: "2026-07-25" },
    now,
  );

  assert.equal(snapshot?.tradeDate, null);
  assert.equal(snapshot?.freshness, "unknown");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("numeric epoch strings are normalized", () => {
  const snapshot = buildSpxPriceSnapshot(
    {
      last: 6375.25,
      trade_date: String(Math.floor((now.getTime() - 45_000) / 1_000)),
    },
    now,
  );

  assert.equal(snapshot?.ageSeconds, 45);
  assert.equal(snapshot?.freshness, "live");
});

test("a crossed bid ask market is rejected as a midpoint", () => {
  const snapshot = buildSpxPriceSnapshot(
    {
      bid: 6378,
      ask: 6374,
      bid_date: now.getTime() - 10_000,
      ask_date: now.getTime() - 10_000,
      close: 6300,
      trade_date: now.getTime() - 10_000,
    },
    now,
  );

  assert.equal(snapshot?.price, 6300);
  assert.equal(snapshot?.priceSource, "close");
  assert.equal(snapshot?.timestampSource, "trade_date");
  assert.equal(canBuildSpxwTriggerFromQuote(snapshot), false);
});

test("a crossed bid ask market without a fallback price is rejected", () => {
  const snapshot = buildSpxPriceSnapshot(
    {
      bid: 6378,
      ask: 6374,
      bid_date: now.getTime() - 10_000,
      ask_date: now.getTime() - 10_000,
    },
    now,
  );

  assert.equal(snapshot, null);
});
