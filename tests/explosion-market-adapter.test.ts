import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExplosionComponents,
  evaluateExplosionScores,
  mapIndicatorFreshness,
  type ExplosionIndicatorFrame,
} from "../lib/trading/explosion";

function frame(overrides: Partial<ExplosionIndicatorFrame> = {}): ExplosionIndicatorFrame {
  return {
    lastPrice: 6400,
    dataStatus: { freshness: "recent" },
    rsi: { value: 58 },
    macd: { histogram: 4, previousHistogram: 2 },
    bollingerBands: { upper: 6395, mid: 6375, lower: 6355 },
    stockMetrics: {
      ema9: 6390,
      ema20: 6380,
      ema50: 6360,
      vwap: 6370,
      atr14: 12,
      relativeVolume: 1.5,
      structure: "HIGHER_HIGH_HIGHER_LOW",
    },
    supportResistance: { support: 6360, resistance: 6395, val: 6350, vah: 6390, poc: 6370 },
    ...overrides,
  };
}

test("builds six directional components without inventing optional metrics", () => {
  const components = buildExplosionComponents({
    spxFiveMinute: frame(),
    spxFifteenMinute: frame(),
    spyFiveMinute: frame(),
  });
  const scores = evaluateExplosionScores(components, 0.85);
  assert.equal(Object.keys(components).length, 6);
  assert.equal(components.momentum.status, "OPTIONAL_MISSING");
  assert.ok(components.momentum.missingMetrics.includes("ADX"));
  assert.equal(scores.requiredDataMissing, false);
  assert.ok((scores.bullScore ?? 0) > (scores.bearScore ?? 0));
});

test("missing SPY RVOL is required data missing", () => {
  const spy = frame();
  spy.stockMetrics.relativeVolume = null;
  const components = buildExplosionComponents({ spxFiveMinute: frame(), spxFifteenMinute: frame(), spyFiveMinute: spy });
  assert.equal(components.volume.status, "REQUIRED_MISSING");
  assert.equal(evaluateExplosionScores(components, 0.85).requiredDataMissing, true);
});

test("freshness is fail-closed", () => {
  assert.equal(mapIndicatorFreshness([frame(), frame()]), "FRESH");
  assert.equal(mapIndicatorFreshness([frame(), frame({ dataStatus: { freshness: "stale" } })]), "STALE");
  assert.equal(mapIndicatorFreshness([frame({ dataStatus: { freshness: "unknown" } })]), "MISSING");
});
