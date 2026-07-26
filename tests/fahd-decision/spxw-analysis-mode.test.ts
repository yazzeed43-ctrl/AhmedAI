import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpxwPremarketWatchlist,
} from "../../lib/trading/fahd-decision/spxw-analysis-mode";
import { determineFinalTradeDecision } from "../../lib/trading/fahd-decision/final-trade-decision";

const unavailableGate = {
  level: "CAUTION" as const,
  blockNewTrades: true,
  blockCause: "INCOMPLETE_DATA" as const,
  warnExistingPositions: false,
  existingPositionAction: "NONE" as const,
  dataStatus: "UNAVAILABLE" as const,
  reason: "Calendar unavailable.",
};

const opportunity = {
  contractSymbol: "SPXW260728C07400000",
  direction: "CALL" as const,
  strike: 7400,
  expiration: "2026-07-28",
  midpoint: 8.25,
  finalScore: 78,
};

test("same stale scan prepares a watchlist but live execution remains WAIT_DATA", () => {
  const scan = {
    status: "OPPORTUNITIES_FOUND",
    underlyingPrice: 7398,
    underlyingQuote: { freshness: "stale", priceSource: "close" },
    opportunities: [opportunity],
  };

  const preparation = buildSpxwPremarketWatchlist({
    scan,
    economicGate: unavailableGate,
  });
  assert.equal(preparation.preparationStatus, "WATCHLIST_READY");
  assert.equal(preparation.dataFreshness, "PREPARATION_ONLY");
  assert.equal(preparation.isExecutable, false);
  assert.equal(preparation.executableTrigger, null);
  assert.equal(preparation.watchlist.length, 1);
  assert.equal("triggerPrice" in preparation.watchlist[0], false);
  assert.equal("state" in preparation.watchlist[0], false);

  const liveDecision = determineFinalTradeDecision({
    scanStatus: scan.status,
    economicGate: unavailableGate,
    triggerDataIsFresh: false,
    candleState: "WAIT_FRESH_PRICE",
    triggerBuilt: false,
    newsEvaluationStatus: "NOT_RUN",
    newsApplication: null,
  });
  assert.equal(liveDecision, "WAIT_DATA");
});

test("PARTIAL_DATA keeps opportunities diagnostic-only", () => {
  const result = buildSpxwPremarketWatchlist({
    scan: {
      status: "PARTIAL_DATA",
      underlyingPrice: 7398,
      opportunities: [opportunity],
    },
    economicGate: unavailableGate,
  });
  assert.equal(result.preparationStatus, "PARTIAL_DATA");
  assert.deepEqual(result.watchlist, []);
  assert.deepEqual(result.referenceLevels, []);
  assert.deepEqual(result.diagnosticOpportunities, [opportunity]);
});

test("NO_MATCH is an explained empty report without reference levels", () => {
  const result = buildSpxwPremarketWatchlist({
    scan: {
      status: "NO_MATCH",
      underlyingPrice: 7398,
      opportunities: [],
      contractsScanned: 3732,
      spxwContractsFound: 1200,
      rejectionReasons: ["No contract passed all unchanged filters."],
    },
    economicGate: unavailableGate,
  });
  assert.equal(result.preparationStatus, "NO_MATCH");
  assert.deepEqual(result.watchlist, []);
  assert.deepEqual(result.referenceLevels, []);
  assert.equal(result.scanDiagnostics.contractsScanned, 3732);
  assert.equal(result.scanDiagnostics.rejectionReasons.length, 1);
});
