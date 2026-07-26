import assert from "node:assert/strict";
import test from "node:test";
import {
  rankPremarketDirections,
  type PremarketCandidate,
} from "../lib/trading/premarket-universe-ranking";

function opportunity(
  direction: "CALL" | "PUT",
  symbol: string,
  score: number,
): PremarketCandidate {
  return {
    rank: 99,
    direction,
    volume: 500,
    openInterest: 1000,
    score,
  };
}

test("premarket ranks CALL and PUT from one shared candidate set even on WAIT bias", () => {
  const result = rankPremarketDirections({
    opportunities: [
      opportunity("CALL", "NVDA", 100),
      opportunity("PUT", "TSLA", 100),
    ],
    marketBias: "WAIT",
    bullishProbability: 50,
    bearishProbability: 50,
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.puts.length, 1);
  assert.equal(result.calls[0].preparationStatus, "WATCH_ONLY");
  assert.equal(result.puts[0].preparationStatus, "WATCH_ONLY");
});

test("premarket preserves Fahd's 60/40 finalScore and threshold", () => {
  const result = rankPremarketDirections({
    opportunities: [
      opportunity("CALL", "AAPL", 90),
      opportunity("PUT", "AMD", 70),
    ],
    marketBias: "CALL_BIAS",
    bullishProbability: 80,
    bearishProbability: 20,
  });
  assert.equal(result.calls[0].finalScore, 86);
  assert.equal(result.puts.length, 0);
});

test("premarket limits each direction independently", () => {
  const result = rankPremarketDirections({
    opportunities: [
      opportunity("CALL", "AAPL", 95),
      opportunity("CALL", "NVDA", 94),
      opportunity("PUT", "TSLA", 95),
      opportunity("PUT", "META", 94),
    ],
    marketBias: "WAIT",
    bullishProbability: 60,
    bearishProbability: 60,
    resultsPerDirection: 1,
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.puts.length, 1);
});
