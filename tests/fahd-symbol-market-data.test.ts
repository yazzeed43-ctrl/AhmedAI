import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSymbolValidationCacheForTests,
  extractTickerCandidates,
  filterValidatedSymbols,
  validateSymbol,
} from "../lib/fahd/symbol-market-data";

test.beforeEach(() => {
  clearSymbolValidationCacheForTests();
});

test("filters common English words such as THE", () => {
  assert.deepEqual(extractTickerCandidates("Analyze THE market for TSLA"), ["TSLA"]);
});

test("keeps SPX as a request classifier candidate", () => {
  assert.deepEqual(extractTickerCandidates("SPX call setup"), ["SPX"]);
});

test("accepts a provider-confirmed symbol", async () => {
  const symbols = await filterValidatedSymbols(["TSLA"], async () => true);
  assert.deepEqual(symbols, ["TSLA"]);
});

test("returns unknown on provider failure and allows the symbol through", async () => {
  const result = await validateSymbol("TSLA", async () => {
    throw new Error("temporary provider outage");
  });
  assert.equal(result.status, "unknown");

  const symbols = await filterValidatedSymbols(["TSLA"], async () => {
    throw new Error("temporary provider outage");
  });
  assert.deepEqual(symbols, ["TSLA"]);
});

test("filters a provider-confirmed invalid symbol", async () => {
  const symbols = await filterValidatedSymbols(["XZQVT"], async () => false);
  assert.deepEqual(symbols, []);
});

test("deduplicates concurrent provider validation", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = async () => {
    calls += 1;
    await gate;
    return true;
  };

  const first = validateSymbol("AAPL", provider);
  const second = validateSymbol("AAPL", provider);
  release?.();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.status, "valid");
  assert.equal(b.status, "valid");
});
