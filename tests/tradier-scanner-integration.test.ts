import assert from "node:assert/strict";
import test from "node:test";
import { scanTradierOpportunities } from "../lib/trading/tradier-scanner";
import {
  formatUnifiedPremarketWatchlist,
  isUnifiedPremarketPreparationRequest,
  scanUnifiedPremarketUniverse,
} from "../lib/trading/unified-premarket-scanner";
import type { BaseOpportunity } from "../lib/trading/tradier-scanner-core/types";

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const permissiveScannerConfig = {
  symbols: ["NVDA"],
  maxDte: 7,
  expirationsPerSymbol: 2,
  results: 5,
  minPrice: 0.01,
  maxPrice: 20,
  minVolume: 0,
  minOpenInterest: 0,
  maxSpreadPercent: 100,
  minDelta: 0,
  maxDelta: 1,
};

const validQuote = {
  symbol: "NVDA",
  last: 100,
  change_percentage: 1,
  trade_date: Date.now(),
};

function validOption(expiration: string) {
  return {
    symbol: `NVDA_${expiration}_CALL`,
    option_type: "call" as const,
    strike: 100,
    expiration_date: expiration,
    bid: 1,
    ask: 1.05,
    last: 1.02,
    volume: 1_000,
    open_interest: 2_000,
    greeks: {
      delta: 0.55,
      gamma: 0.04,
      theta: -0.2,
      vega: 0.1,
      mid_iv: null,
    },
  };
}

async function neutralIvEnrichment(item: BaseOpportunity) {
  return {
    ...item,
    ivContext: {
      ivRank: null,
      ivPercentile: null,
      samples: 0,
      signal: "INSUFFICIENT_DATA" as const,
      scoreAdjustment: 0,
    },
  };
}

test("the real scanner loop reports a successful and a failed expiration as partial", async () => {
  const successfulExpiration = futureDate(2);
  const failedExpiration = futureDate(3);

  const result = await scanTradierOpportunities(
    permissiveScannerConfig,
    {
      getQuotes: async () => [validQuote],
      getExpirations: async () => [successfulExpiration, failedExpiration],
      getOptionChain: async (_symbol, expiration) => {
        if (expiration === failedExpiration) {
          throw new Error("simulated chain failure");
        }
        return [validOption(successfulExpiration)];
      },
      enrichWithIVHistory: neutralIvEnrichment,
    },
  );

  assert.equal(result.dataStatus, "PARTIAL_DATA");
  assert.equal(result.outcome, "OPPORTUNITIES_FOUND");
  assert.equal(result.diagnostic, "NONE");
  assert.equal(result.expirationsRequested, 2);
  assert.equal(result.expirationsSucceeded, 1);
  assert.equal(result.expirationsFailed, 1);
  assert.equal(result.symbolsWithAnySuccess, 1);
  assert.equal(result.symbolsFailedCompletely, 0);
  assert.equal(result.providerErrors.length, 1);
  assert.equal(result.providerErrors[0]?.code, "CHAIN_REQUEST_FAILED");
  assert.equal(typeof result.dataStatus, "string");
  assert.equal(typeof result.outcome, "string");
  assert.equal(typeof result.diagnostic, "string");
  assert.equal("status" in result, false);
});

test("the real scanner loop reports complete data with opportunities", async () => {
  const expirations = [futureDate(2), futureDate(3)];
  const result = await scanTradierOpportunities(permissiveScannerConfig, {
    getQuotes: async () => [validQuote],
    getExpirations: async () => expirations,
    getOptionChain: async (_symbol, expiration) => [validOption(expiration)],
    enrichWithIVHistory: neutralIvEnrichment,
  });

  assert.equal(result.dataStatus, "COMPLETE");
  assert.equal(result.outcome, "OPPORTUNITIES_FOUND");
  assert.equal(result.diagnostic, "NONE");
  assert.equal(result.expirationsRequested, 2);
  assert.equal(result.expirationsSucceeded, 2);
  assert.equal(result.expirationsFailed, 0);
  assert.equal(result.providerErrors.length, 0);
});

test("the real scanner loop reports complete data without opportunities", async () => {
  const expirations = [futureDate(2), futureDate(3)];
  const result = await scanTradierOpportunities(permissiveScannerConfig, {
    getQuotes: async () => [validQuote],
    getExpirations: async () => expirations,
    getOptionChain: async () => [],
    enrichWithIVHistory: neutralIvEnrichment,
  });

  assert.equal(result.dataStatus, "COMPLETE");
  assert.equal(result.outcome, "NO_OPPORTUNITIES");
  assert.equal(result.diagnostic, "NONE");
  assert.equal(result.expirationsRequested, 2);
  assert.equal(result.expirationsSucceeded, 2);
  assert.equal(result.expirationsFailed, 0);
  assert.equal(result.providerErrors.length, 0);
});

test("the real scanner loop reports a fatal error when every chain fails", async () => {
  const expirations = [futureDate(2), futureDate(3)];
  const result = await scanTradierOpportunities(permissiveScannerConfig, {
    getQuotes: async () => [validQuote],
    getExpirations: async () => expirations,
    getOptionChain: async () => {
      throw new Error("simulated chain failure");
    },
    enrichWithIVHistory: neutralIvEnrichment,
  });

  assert.equal(result.dataStatus, "DATA_PROVIDER_ERROR");
  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.diagnostic, "NO_SUCCESSFUL_EXPIRATIONS");
  assert.equal(result.expirationsRequested, 2);
  assert.equal(result.expirationsSucceeded, 0);
  assert.equal(result.expirationsFailed, 2);
  assert.equal(result.symbolsWithAnySuccess, 0);
  assert.equal(result.symbolsFailedCompletely, 1);
  assert.equal(result.providerErrors.length, 2);
  assert.equal(result.opportunities.length, 0);
});

test("the unified scanner publishes the new stockScan API contract", async () => {
  const result = await scanUnifiedPremarketUniverse(
    { symbols: ["NVDA"] },
    {
      getMarketDecision: async () => ({
        bias: "WAIT",
        probabilities: { bullish: 50, bearish: 50 },
      }),
      scanStocks: async () => ({
        dataStatus: "COMPLETE",
        outcome: "NO_OPPORTUNITIES",
        diagnostic: "NONE",
        symbolsRequested: 1,
        symbolsWithAnySuccess: 1,
        symbolsFailedCompletely: 0,
        expirationsRequested: 1,
        expirationsSucceeded: 1,
        expirationsFailed: 0,
        providerErrors: [],
        contractsScanned: 0,
        qualifiedContracts: 0,
        opportunities: [],
      }),
      scanSpxw: async () => ({
        status: "NO_MATCH",
        contractsScanned: 0,
        expirationsRequested: 1,
        expirationsSucceeded: 1,
        expirationsFailed: 0,
        providerErrors: [],
        opportunities: [],
      }),
    },
  );

  assert.equal(result.stockScan.dataStatus, "COMPLETE");
  assert.equal(result.stockScan.outcome, "NO_OPPORTUNITIES");
  assert.equal(result.stockScan.diagnostic, "NONE");
  assert.equal("status" in result.stockScan, false);
  assert.deepEqual(result.stockScan.callWatchlist, []);
  assert.deepEqual(result.stockScan.putWatchlist, []);
  assert.equal(result.isExecutable, false);
  assert.equal(result.executableTrigger, null);
});

test("SPXW premarket output preserves scan-level price provenance", async () => {
  const result = await scanUnifiedPremarketUniverse(
    { symbols: ["NVDA"] },
    {
      getMarketDecision: async () => ({
        bias: "PUT_BIAS",
        probabilities: { bullish: 20, bearish: 80 },
      }),
      scanStocks: async () => ({
        dataStatus: "COMPLETE",
        outcome: "NO_OPPORTUNITIES",
        diagnostic: "NONE",
        symbolsRequested: 1,
        symbolsWithAnySuccess: 1,
        symbolsFailedCompletely: 0,
        expirationsRequested: 1,
        expirationsSucceeded: 1,
        expirationsFailed: 0,
        providerErrors: [],
        contractsScanned: 0,
        qualifiedContracts: 0,
        opportunities: [],
      }),
      scanSpxw: async () => ({
        status: "OPPORTUNITIES_FOUND",
        contractsScanned: 1,
        expirationsRequested: 1,
        expirationsSucceeded: 1,
        expirationsFailed: 0,
        providerErrors: [],
        underlyingQuote: {
          price: 7411.98,
          freshness: "stale",
          priceSource: "close",
          ageSeconds: 119868,
          tradeDate: "2026-07-24T21:26:00.000Z",
        },
        opportunities: [
          {
            direction: "PUT",
            contractSymbol: "SPXW260727P07420000",
            strike: 7420,
            expiration: "2026-07-27",
            midpoint: 2.58,
            finalScore: 78,
          },
        ],
      }),
    },
  );

  assert.equal(result.spxwScan.underlyingQuote?.freshness, "stale");
  assert.equal(result.spxwScan.underlyingQuote?.priceSource, "close");

  const message = formatUnifiedPremarketWatchlist(result);

  assert.match(
    message,
    /SPX reference: price 7411\.98 \| freshness stale \| priceSource close/,
  );
  assert.doesNotMatch(
    message,
    /SPXW260727P07420000[^\n]*freshness unknown/,
  );
});

test("unified premarket requests are routed without an extra model round", () => {
  assert.equal(
    isUnifiedPremarketPreparationRequest(
      "شغّل وضع PREMARKET_PREP وجهّز قائمة فهد الموحدة للأسهم وSPXW الآن",
    ),
    true,
  );
  assert.equal(
    isUnifiedPremarketPreparationRequest(
      "جهّز قائمة مراقبة موحدة قبل السوق لأسهم NVDA وSPXW",
    ),
    true,
  );
  assert.equal(isUnifiedPremarketPreparationRequest("حلل TSLA الآن"), false);
  assert.equal(
    isUnifiedPremarketPreparationRequest("جهّز SPXW قبل السوق"),
    false,
  );
});
