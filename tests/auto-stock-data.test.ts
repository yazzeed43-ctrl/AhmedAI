import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchStockData,
  type StockDataDeps,
} from "../lib/trading/auto-stock-data";

function fakeIndicators(overrides: Record<string, unknown> = {}) {
  return {
    rsi: { value: 62 },
    macd: { histogram: 1.2, previousHistogram: 0.8 },
    stockMetrics: {
      vwap: 250.5,
      ema20: 248,
      ema50: 245,
      relativeVolume: 1.4,
      volume: 1_200_000,
      averageVolume20: 900_000,
    },
    supportResistance: {
      support: 240,
      resistance: 260,
      val: 241,
      vah: 258,
      poc: 250,
      source: "volume_profile",
    },
    ...overrides,
  };
}

function fakeQuote(overrides: Record<string, unknown> = {}) {
  return { last: 251.75, close: 250, ...overrides };
}

function deps(overrides: Partial<StockDataDeps> = {}): StockDataDeps {
  return {
    getIndicators: (async () => fakeIndicators()) as any,
    getQuote: (async () => fakeQuote()) as any,
    ...overrides,
  };
}

test("builds RawStockData and triggerLevels from a successful fetch", async () => {
  const result = await fetchStockData("tsla", "15min", deps());

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.stock.symbol, "TSLA"); // تطبيع الحروف الكبيرة
    assert.equal(result.stock.price, 251.75);
    assert.equal(result.stock.vwap, 250.5);
    assert.equal(result.stock.rsi, 62);
    assert.equal(result.stock.macdHistogram, 1.2);
    assert.equal(result.stock.vah, 258);
    assert.equal(result.stock.val, 241);
    assert.equal(result.stock.poc, 250);
    assert.equal(result.stock.support, 240);
    assert.equal(result.stock.resistance, 260);
    assert.equal(result.stock.ema200, null);
    assert.equal(result.stock.adx, null);

    assert.equal(result.triggerLevels.price, 251.75);
    assert.equal(result.triggerLevels.vah, 258);
    assert.equal(result.triggerLevels.val, 241);
  }
});

test("vah/val fall back to raw resistance/support when volume profile is missing", async () => {
  const result = await fetchStockData(
    "TSLA",
    "15min",
    deps({
      getIndicators: (async () =>
        fakeIndicators({
          supportResistance: {
            support: 240,
            resistance: 260,
            source: "historical_range",
            // لا val/vah/poc
          },
        })) as any,
    })
  );

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.stock.vah, 260); // = resistance
    assert.equal(result.stock.val, 240); // = support
    assert.equal(result.stock.poc, null);
  }
});

test("invalid symbol format returns WAIT_DATA without any fetch", async () => {
  let called = false;
  const result = await fetchStockData(
    "!!!",
    "15min",
    deps({
      getIndicators: (async () => {
        called = true;
        return fakeIndicators();
      }) as any,
    })
  );

  assert.equal(result.status, "WAIT_DATA");
  assert.equal(called, false);
});

test("missing price from both quote and indicators returns WAIT_DATA", async () => {
  const result = await fetchStockData(
    "TSLA",
    "15min",
    deps({
      getQuote: (async () => ({ error: "TIMEOUT" })) as any,
      getIndicators: (async () => ({ error: "NO_DATA" })) as any,
    })
  );

  assert.equal(result.status, "WAIT_DATA");
});

test("indicator failure still returns a price-only stock with null levels", async () => {
  const result = await fetchStockData(
    "TSLA",
    "15min",
    deps({
      getIndicators: (async () => ({ error: "NO_DATA" })) as any,
    })
  );

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.stock.price, 251.75);
    assert.equal(result.stock.vah, null);
    assert.equal(result.stock.support, null);
    assert.equal(result.triggerLevels.resistance, null);
  }
});
