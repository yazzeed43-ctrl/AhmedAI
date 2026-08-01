import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EXPLOSION_CONFIG,
  evaluateExplosionEngine,
  evaluateExplosionScores,
  evaluatePostExecutionState,
  evaluatePreExecutionState,
  registerEligibleClosedBar,
  resolveExplosionDirection,
  type ComponentResult,
  type ExplosionComponents,
  type ExplosionEngineInput,
  type TriggerTouchSnapshot,
} from "../lib/trading/explosion";

const WEIGHTS = {
  trend: 15,
  momentum: 20,
  volatility: 20,
  volume: 15,
  location: 10,
  structureLiquidity: 20,
} as const;

function component(
  maximumWeight: number,
  bullPercent: number,
  bearPercent: number,
  overrides: Partial<ComponentResult> = {},
): ComponentResult {
  const configuredMetricWeight = overrides.configuredMetricWeight ?? maximumWeight;
  const availableMetricWeight = overrides.availableMetricWeight ?? configuredMetricWeight;
  return {
    bullEarned: (bullPercent / 100) * availableMetricWeight,
    bearEarned: (bearPercent / 100) * availableMetricWeight,
    maximumWeight,
    availableMetricWeight,
    configuredMetricWeight,
    status: "AVAILABLE",
    reasons: [],
    missingMetrics: [],
    ...overrides,
  };
}

function components(
  bullPercent = 86,
  bearPercent = 60,
): ExplosionComponents {
  return {
    trend: component(WEIGHTS.trend, bullPercent, bearPercent),
    momentum: component(WEIGHTS.momentum, bullPercent, bearPercent),
    volatility: component(WEIGHTS.volatility, bullPercent, bearPercent),
    volume: component(WEIGHTS.volume, bullPercent, bearPercent),
    location: component(WEIGHTS.location, bullPercent, bearPercent),
    structureLiquidity: component(
      WEIGHTS.structureLiquidity,
      bullPercent,
      bearPercent,
    ),
  };
}

function touchSnapshot(): TriggerTouchSnapshot {
  return {
    touchedAt: "2026-08-03T13:30:01.000Z",
    touchedBarTime: "2026-08-03T13:30:00.000Z",
    firstEligibleConfirmationBarTime: null,
    lastEvaluatedBarTime: null,
    confirmationBarsEvaluated: 0,
  };
}

function engineInput(
  overrides: Partial<ExplosionEngineInput> = {},
): ExplosionEngineInput {
  return {
    components: components(),
    preExecution: {
      now: "2026-08-03T13:36:00.000Z",
      candle: {
        openTime: "2026-08-03T13:35:00.000Z",
        closed: true,
      },
      touchSnapshot: touchSnapshot(),
      requiredDataMissing: false,
      invalidationHit: false,
      triggerTouched: true,
      candleClosedBeyondTrigger: true,
      entryNotExtended: true,
      breakoutAttemptWasValid: true,
    },
    contractQuality: 88,
    breakoutVolumeConfirmed: true,
    underlyingDataStatus: "FRESH",
    contractDataStatus: "FRESH",
    contractLiquid: true,
    economicCalendarStatus: "COMPLETE",
    economicGateAllowsEntry: true,
    executableTrigger: 6425,
    invalidationLevel: 6412,
    setupId: "CALL|2026-08-03T13:30:00.000Z|6425",
    ...overrides,
  };
}

test("direction requires both minimum score and minimum edge", () => {
  assert.equal(resolveExplosionDirection(82, 75, 65, 10).direction, "NEUTRAL");
  assert.equal(resolveExplosionDirection(82, 70, 65, 10).direction, "CALL");
  assert.equal(resolveExplosionDirection(68, 81, 65, 10).direction, "PUT");
  assert.equal(resolveExplosionDirection(62, 40, 65, 10).direction, "NEUTRAL");
});

test("optional metrics normalize only inside their component", () => {
  const input = components(80, 50);
  input.momentum = component(20, 80, 50, {
    configuredMetricWeight: 20,
    availableMetricWeight: 16,
    status: "OPTIONAL_MISSING",
    missingMetrics: ["ADX"],
  });

  const result = evaluateExplosionScores(input, 0.85);
  assert.equal(result.requiredDataMissing, false);
  assert.equal(result.bullScore, 80);
  assert.equal(result.scoreCoverage, 0.96);
});

test("required metrics missing always produce unavailable scores", () => {
  const input = components();
  input.momentum = component(20, 80, 20, {
    status: "REQUIRED_MISSING",
    missingMetrics: ["RSI"],
  });

  const result = evaluateExplosionScores(input, 0.85);
  assert.equal(result.requiredDataMissing, true);
  assert.equal(result.bullScore, null);
  assert.match(result.blockers.join(" "), /RSI/);
});

test("invalid component weights fail closed instead of inflating the score", () => {
  const invalidTotal = components();
  invalidTotal.trend.maximumWeight = 25;
  assert.equal(
    evaluateExplosionScores(invalidTotal, 0.85).requiredDataMissing,
    true,
  );

  const invalidEarned = components();
  invalidEarned.volume.bullEarned =
    invalidEarned.volume.availableMetricWeight + 1;
  assert.equal(
    evaluateExplosionScores(invalidEarned, 0.85).requiredDataMissing,
    true,
  );
});

test("score coverage rejects 84 percent and accepts 85 percent", () => {
  const low = components();
  low.structureLiquidity.availableMetricWeight = 4;
  low.structureLiquidity.bullEarned = 3.44;
  low.structureLiquidity.bearEarned = 2.4;
  low.structureLiquidity.status = "OPTIONAL_MISSING";
  assert.equal(evaluateExplosionScores(low, 0.85).requiredDataMissing, true);

  const boundary = components();
  boundary.structureLiquidity.availableMetricWeight = 5;
  boundary.structureLiquidity.bullEarned = 4.3;
  boundary.structureLiquidity.bearEarned = 3;
  boundary.structureLiquidity.status = "OPTIONAL_MISSING";
  assert.equal(evaluateExplosionScores(boundary, 0.85).requiredDataMissing, false);
});

test("touch is recorded as an event and touch candle cannot confirm", () => {
  const first = evaluatePreExecutionState(
    {
      ...engineInput().preExecution,
      candle: { openTime: "2026-08-03T13:30:00.000Z", closed: false },
      touchSnapshot: null,
    },
    DEFAULT_EXPLOSION_CONFIG,
  );
  assert.equal(first.state, "WAIT_CANDLE_CLOSE");
  assert.equal(first.events[0]?.type, "TRIGGER_TOUCHED");

  const sameCandleClose = evaluatePreExecutionState(
    {
      ...engineInput().preExecution,
      candle: { openTime: "2026-08-03T13:30:00.000Z", closed: true },
      touchSnapshot: first.touchSnapshot,
    },
    DEFAULT_EXPLOSION_CONFIG,
  );
  assert.equal(sameCandleClose.state, "WAIT_CANDLE_CLOSE");
  assert.equal(sameCandleClose.touchSnapshot?.confirmationBarsEvaluated, 0);
});

test("the same closed candle is counted only once", () => {
  const snapshot = touchSnapshot();
  const candle = { openTime: "2026-08-03T13:35:00.000Z", closed: true };
  const once = registerEligibleClosedBar(snapshot, candle);
  const twice = registerEligibleClosedBar(once, candle);
  assert.equal(once.confirmationBarsEvaluated, 1);
  assert.equal(twice.confirmationBarsEvaluated, 1);
});

test("last eligible bar gets full confirmation before expiry", () => {
  const thirdBar: TriggerTouchSnapshot = {
    ...touchSnapshot(),
    firstEligibleConfirmationBarTime: "2026-08-03T13:35:00.000Z",
    lastEvaluatedBarTime: "2026-08-03T13:40:00.000Z",
    confirmationBarsEvaluated: 2,
  };
  const confirmed = evaluatePreExecutionState(
    {
      ...engineInput().preExecution,
      candle: { openTime: "2026-08-03T13:45:00.000Z", closed: true },
      touchSnapshot: thirdBar,
    },
    DEFAULT_EXPLOSION_CONFIG,
  );
  assert.equal(confirmed.state, "CANDLE_CONFIRMED");
  assert.equal(confirmed.touchSnapshot?.confirmationBarsEvaluated, 3);
});

test("last bar distinguishes missed entry, failed breakout, and expiry", () => {
  const prior: TriggerTouchSnapshot = {
    ...touchSnapshot(),
    lastEvaluatedBarTime: "2026-08-03T13:40:00.000Z",
    confirmationBarsEvaluated: 2,
  };
  const base = {
    ...engineInput().preExecution,
    candle: { openTime: "2026-08-03T13:45:00.000Z", closed: true },
    touchSnapshot: prior,
  };

  assert.equal(
    evaluatePreExecutionState(
      { ...base, entryNotExtended: false },
      DEFAULT_EXPLOSION_CONFIG,
    ).state,
    "MISSED_ENTRY",
  );
  assert.equal(
    evaluatePreExecutionState(
      { ...base, candleClosedBeyondTrigger: false },
      DEFAULT_EXPLOSION_CONFIG,
    ).state,
    "FAILED_BREAKOUT",
  );
  assert.equal(
    evaluatePreExecutionState(
      {
        ...base,
        candleClosedBeyondTrigger: false,
        breakoutAttemptWasValid: false,
      },
      DEFAULT_EXPLOSION_CONFIG,
    ).state,
    "EXPIRED",
  );
});

test("invalidation wins over trigger and confirmation on the same candle", () => {
  const result = evaluatePreExecutionState(
    {
      ...engineInput().preExecution,
      invalidationHit: true,
    },
    DEFAULT_EXPLOSION_CONFIG,
  );
  assert.equal(result.state, "CANCELLED");
});

test("post execution applies stop-first conservative ordering", () => {
  assert.equal(
    evaluatePostExecutionState(
      {
        stopHit: true,
        target1Hit: true,
        target2Hit: true,
        exhaustionConfirmed: false,
      },
      DEFAULT_EXPLOSION_CONFIG,
    ),
    "STOPPED",
  );
});

test("high score is not executable without every mandatory gate", () => {
  const weakContract = evaluateExplosionEngine(
    engineInput({ contractQuality: 70 }),
  );
  assert.equal(weakContract.state, "CANDLE_CONFIRMED");
  assert.equal(weakContract.decision, "WAIT_CONTRACT");
  assert.equal(weakContract.isExecutable, false);
  assert.equal(weakContract.executableTrigger, null);

  const stale = evaluateExplosionEngine(
    engineInput({ underlyingDataStatus: "STALE" }),
  );
  assert.equal(stale.decision, "WAIT_DATA");
  assert.equal(stale.isExecutable, false);
});

test("all mandatory gates produce the only executable result", () => {
  const result = evaluateExplosionEngine(engineInput());
  assert.equal(result.direction, "CALL");
  assert.equal(result.state, "CANDLE_CONFIRMED");
  assert.equal(result.decision, "EXECUTABLE");
  assert.equal(result.isExecutable, true);
  assert.equal(result.executableTrigger, 6425);
});

test("missing score data produces WAIT_DATA and never exposes a trigger", () => {
  const missing = components();
  missing.volume.status = "REQUIRED_MISSING";
  missing.volume.missingMetrics = ["RVOL"];
  const result = evaluateExplosionEngine(
    engineInput({ components: missing }),
  );
  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(result.isExecutable, false);
  assert.equal(result.executableTrigger, null);
});

test("a missing last eligible candle is WAIT_DATA, never inferred expiry", () => {
  const result = evaluateExplosionEngine(
    engineInput({
      preExecution: {
        ...engineInput().preExecution,
        requiredDataMissing: true,
        candle: { openTime: "2026-08-03T13:50:00.000Z", closed: true },
      },
    }),
  );
  assert.equal(result.decision, "WAIT_DATA");
  assert.notEqual(result.state, "EXPIRED");
});

test("incomplete economic calendar is WAIT_DATA after candle confirmation", () => {
  const result = evaluateExplosionEngine(
    engineInput({ economicCalendarStatus: "UNAVAILABLE" }),
  );
  assert.equal(result.state, "CANDLE_CONFIRMED");
  assert.equal(result.decision, "WAIT_DATA");
  assert.equal(result.isExecutable, false);
});
