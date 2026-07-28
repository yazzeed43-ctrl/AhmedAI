import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMarketData,
  type MarketDataDeps,
} from "../lib/trading/auto-market-data";

function fakeIndicators(overrides: Record<string, unknown> = {}) {
  return {
    rsi: { value: 55 },
    stockMetrics: {
      vwap: 500.5,
      ema20: 498,
      ema50: 495,
    },
    ...overrides,
  };
}

function fakeQuote(overrides: Record<string, unknown> = {}) {
  return {
    last: 501.25,
    close: 500,
    change_percentage: 0.42,
    ...overrides,
  };
}

function deps(overrides: Partial<MarketDataDeps> = {}): MarketDataDeps {
  return {
    getIndicators: (async () => fakeIndicators()) as any,
    getQuote: (async () => fakeQuote()) as any,
    ...overrides,
  };
}

test("builds SPY/QQQ legs from indicators and quote when both succeed", async () => {
  const result = await fetchMarketData("15min", deps());

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.data.spy.price, 501.25);
    assert.equal(result.data.spy.vwap, 500.5);
    assert.equal(result.data.spy.ema20, 498);
    assert.equal(result.data.spy.ema50, 495);
    assert.equal(result.data.spy.rsi, 55);
    assert.equal(result.data.spy.changePercent, 0.42);
    // نفس القيم لأن fakeIndicators/fakeQuote تُستدعى لكل من SPY وQQQ
    assert.equal(result.data.qqq.price, 501.25);
  }
});

test("falls back to close price when last is missing", async () => {
  const result = await fetchMarketData(
    "15min",
    deps({
      getQuote: (async () =>
        fakeQuote({ last: null, close: 499.75 })) as any,
    })
  );

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.data.spy.price, 499.75);
  }
});

test("quote failure returns WAIT_DATA instead of inventing a price", async () => {
  const result = await fetchMarketData(
    "15min",
    deps({
      getQuote: (async () => ({ error: "TIMEOUT" })) as any,
    })
  );

  assert.equal(result.status, "WAIT_DATA");
  if (result.status === "WAIT_DATA") {
    assert.match(result.reason, /SPY/);
  }
});

test("indicator failure still allows a price-only leg via the quote", async () => {
  const result = await fetchMarketData(
    "15min",
    deps({
      getIndicators: (async () => ({ error: "NO_DATA" })) as any,
    })
  );

  // السعر متوفر من العرض حتى لو المؤشرات فشلت؛ vwap/ema/rsi تبقى null
  // بدل ما تُخترع، والتقرير لاحقًا يتعامل معها كحقول اختيارية غائبة.
  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.data.spy.price, 501.25);
    assert.equal(result.data.spy.vwap, null);
    assert.equal(result.data.spy.rsi, null);
  }
});

test("total data failure for both price sources returns WAIT_DATA", async () => {
  const result = await fetchMarketData(
    "15min",
    deps({
      getIndicators: (async () => ({ error: "NO_DATA" })) as any,
      getQuote: (async () => ({ error: "TIMEOUT" })) as any,
    })
  );

  assert.equal(result.status, "WAIT_DATA");
});
