import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExplosionDiagnostic,
  isExplosionDiagnosticRequest,
} from "../lib/trading/explosion/fahd-response";

test("detects a direct SPXW explosion request", () => {
  assert.equal(
    isExplosionDiagnosticRequest("افحص زخم وسيولة وانفجار SPXW الآن"),
    true,
  );
  assert.equal(
    isExplosionDiagnosticRequest("جهز قائمة مراقبة SPXW قبل السوق"),
    false,
  );
});

test("formats the diagnostic as a safe Arabic Fahd reply", () => {
  const reply = formatExplosionDiagnostic({
    spxPrice: {
      price: 6400,
      priceSource: "last",
      freshness: "stale",
      ageSeconds: 120,
    },
    technicalProxy: { symbol: "SPY", timeframes: ["5min", "15min"] },
    engine: {
      bullScore: 82.126,
      bearScore: 61.234,
      selectedExplosionScore: 82.126,
      scoreEdge: 20.892,
      scoreCoverage: 0.91,
      direction: "CALL",
      state: "WAIT_CANDLE_CLOSE",
      decision: "WAIT_DATA",
      blockers: ["Underlying data is not fresh"],
    },
    integration: {
      selectedContract: {
        contractSymbol: "SPXW260801C06400000",
        direction: "CALL",
        strike: 6400,
        expiration: "2026-08-01",
        midpoint: 4.2,
        contractScore: 88,
        finalScore: 84,
      },
      selectedContractQuote: null,
      economicGate: {
        dataStatus: "UNAVAILABLE",
        blockNewTrades: true,
        blockCause: "INCOMPLETE_DATA",
      },
    },
  });

  assert.match(reply, /محرك زخم وسيولة وانفجار SPXW/);
  assert.match(reply, /القرار: WAIT_DATA/);
  assert.match(reply, /الاتجاه: CALL/);
  assert.match(reply, /SPXW260801C06400000/);
  assert.match(reply, /بيانات SPX غير لحظية/);
  assert.match(reply, /غير قابل للتنفيذ/);
});

test("does not invent a contract when none was selected", () => {
  const reply = formatExplosionDiagnostic({
    engine: { direction: "NEUTRAL", decision: "WAIT_DATA" },
    integration: { selectedContract: null },
  });
  assert.match(reply, /لا يوجد عقد SPXW مطابق/);
});
