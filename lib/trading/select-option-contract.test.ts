// lib/trading/select-option-contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { selectOptionContract } from "./select-option-contract";
import type { OptionContract } from "../tradier";

function makeOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    tier: "GOLD",
    underlying: "NVDA",
    underlyingPrice: 190,
    underlyingChangePercent: 0.5,
    priceSource: "last",
    tradeDate: "2026-07-28",
    ageSeconds: 5,
    freshness: "live",
    direction: "CALL",
    contractSymbol: "NVDA260807C00190000",
    expiration: "2026-08-07",
    daysToExpiration: 10,
    strike: 190,
    bid: 2.1,
    ask: 2.2,
    midpoint: 2.15,
    spreadPercent: 4.5,
    last: 2.15,
    delta: 0.35,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.1,
    impliedVolatility: 0.4,
    volume: 1200,
    openInterest: 5000,
    proximityPercent: 1.2,
    score: 88,
    reasons: [],
    warnings: [],
    optionBrain: {} as never,
    ivContext: {} as never,
    ...overrides,
  };
}

function makeChainContract(
  overrides: Partial<OptionContract> = {},
): OptionContract {
  return {
    symbol: "NVDA260821C00195000",
    strike: 195,
    option_type: "call",
    expiration_date: "2026-08-21",
    bid: 1.8,
    ask: 1.9,
    last: 1.85,
    volume: 300,
    open_interest: 900,
    spread_pct: 5.5,
    liquidity_quality: "جيد",
    liquidity_reason: "سيولة كافية",
    ...overrides,
  };
}

test("1) AUTO ناجح - يختار أول عنصر مطابق للاتجاه من الماسح", async () => {
  const scan = async () => ({
    dataStatus: "COMPLETE" as const,
    outcome: "OPPORTUNITIES_FOUND" as const,
    opportunities: [
      makeOpportunity({ rank: 2, strike: 195 }),
      makeOpportunity({ rank: 1, strike: 190 }),
    ],
  });

  const result = await selectOptionContract({
    symbol: "nvda",
    direction: "CALL",
    deps: { scanOpportunities: scan as never },
  });

  assert.equal(result.status, "READY");

  if (result.status === "READY") {
    assert.equal(result.selectionMode, "AUTO");
    assert.equal(result.contract.strike, 195);
    assert.equal(result.contract.source, "SCANNER");
  }
});

test("2) strike فقط EXACT ناجح عبر الماسح", async () => {
  const scan = async () => ({
    dataStatus: "COMPLETE" as const,
    outcome: "OPPORTUNITIES_FOUND" as const,
    opportunities: [
      makeOpportunity({ rank: 1, strike: 200 }),
      makeOpportunity({ rank: 2, strike: 210 }),
    ],
  });

  const result = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    strike: 210,
    deps: { scanOpportunities: scan as never },
  });

  assert.equal(result.status, "READY");

  if (result.status === "READY") {
    assert.equal(result.selectionMode, "EXACT");
    assert.equal(result.contract.strike, 210);
  }
});

test("3) expiration فقط ناجح عبر getFullOptionsChain + ترتيب سيولة", async () => {
  let calledSymbol = "";
  let calledExpiration = "";

  const fetchChain = async (symbol: string, expiration: string) => {
    calledSymbol = symbol;
    calledExpiration = expiration;

    return [
      makeChainContract({
        strike: 195,
        liquidity_quality: "متوسط",
      }),
      makeChainContract({
        strike: 200,
        liquidity_quality: "جيد",
      }),
    ];
  };

  const result = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    expiration: "2026-08-21",
    deps: { fetchFullChain: fetchChain as never },
  });

  assert.equal(result.status, "READY");

  if (result.status === "READY") {
    assert.equal(result.selectionMode, "EXACT");
    assert.equal(result.contract.source, "FULL_CHAIN");
    assert.equal(result.contract.strike, 200);
  }

  assert.equal(calledSymbol, "NVDA");
  assert.equal(calledExpiration, "2026-08-21");
});

test("4) strike + expiration ناجح عبر findExactOptionContract الحقيقية", async () => {
  const fetchChain = async () => [
    makeChainContract({
      strike: 195,
      symbol: "NVDA260821C00195000",
    }),
    makeChainContract({
      strike: 200,
      symbol: "NVDA260821C00200000",
    }),
  ];

  const result = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    strike: 195,
    expiration: "2026-08-21",
    deps: { fetchFullChain: fetchChain as never },
  });

  assert.equal(result.status, "READY");

  if (result.status === "READY") {
    assert.equal(result.contract.strike, 195);
    assert.equal(result.contract.source, "FULL_CHAIN");
  }
});

test("5) EXACT_CONTRACT_NOT_FOUND حقيقي مع details", async () => {
  const fetchChain = async () => [
    makeChainContract({
      strike: 195,
      symbol: "NVDA260821C00195000",
    }),
  ];

  const result = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    strike: 500,
    expiration: "2026-08-21",
    deps: { fetchFullChain: fetchChain as never },
  });

  assert.equal(result.status, "WAIT_DATA");

  if (result.status === "WAIT_DATA") {
    assert.equal(result.reason, "EXACT_CONTRACT_NOT_FOUND");
    assert.ok(result.details?.reason);
    assert.equal(
      Array.isArray(result.details?.nearestAvailableStrikes),
      true,
    );
    assert.deepEqual(result.warnings, []);
  }
});

test("6) حالات WAIT_DATA من الماسح", async () => {
  const cases = [
    {
      scanResult: {
        dataStatus: "PARTIAL_DATA" as const,
        outcome: "UNKNOWN" as const,
        opportunities: [],
      },
      expectedReason: "PARTIAL_DATA",
    },
    {
      scanResult: {
        dataStatus: "DATA_PROVIDER_ERROR" as const,
        outcome: "UNKNOWN" as const,
        opportunities: [],
      },
      expectedReason: "SCAN_FAILED",
    },
    {
      scanResult: {
        dataStatus: "COMPLETE" as const,
        outcome: "NO_OPPORTUNITIES" as const,
        opportunities: [],
      },
      expectedReason: "NO_OPPORTUNITIES",
    },
  ] as const;

  for (const item of cases) {
    const scan = async () => item.scanResult;

    const result = await selectOptionContract({
      symbol: "NVDA",
      direction: "CALL",
      deps: { scanOpportunities: scan as never },
    });

    assert.equal(result.status, "WAIT_DATA");

    if (result.status === "WAIT_DATA") {
      assert.equal(result.reason, item.expectedReason);
    }
  }
});

test("7) CHAIN_FETCH_FAILED منفصل عن EXACT_CONTRACT_NOT_FOUND", async () => {
  const fetchChain = async (): Promise<OptionContract[]> => {
    throw new Error("Tradier API down");
  };

  const result = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    expiration: "2026-08-21",
    deps: { fetchFullChain: fetchChain as never },
  });

  assert.equal(result.status, "WAIT_DATA");

  if (result.status === "WAIT_DATA") {
    assert.equal(result.reason, "CHAIN_FETCH_FAILED");
  }
});

test("8) AUTO يحافظ على ترتيب opportunities بعد فلترة الاتجاه", async () => {
  const scan = async () => ({
    dataStatus: "COMPLETE" as const,
    outcome: "OPPORTUNITIES_FOUND" as const,
    opportunities: [
      makeOpportunity({
        rank: 1,
        direction: "PUT",
        strike: 180,
      }),
      makeOpportunity({
        rank: 2,
        direction: "CALL",
        strike: 195,
      }),
      makeOpportunity({
        rank: 3,
        direction: "CALL",
        strike: 200,
      }),
    ],
  });

  const result = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    deps: { scanOpportunities: scan as never },
  });

  assert.equal(result.status, "READY");

  if (result.status === "READY") {
    assert.equal(result.contract.strike, 195);
  }
});

test("9) expiration + strike يستخدم findExactOptionContract الحقيقية", async () => {
  const miniChain: OptionContract[] = [
    makeChainContract({
      strike: 190,
      symbol: "NVDA260821C00190000",
    }),
    makeChainContract({
      strike: 195,
      symbol: "NVDA260821C00195000",
    }),
  ];

  const fetchChain = async () => miniChain;

  const found = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    strike: 195,
    expiration: "2026-08-21",
    deps: { fetchFullChain: fetchChain as never },
  });

  assert.equal(found.status, "READY");

  if (found.status === "READY") {
    assert.equal(found.contract.strike, 195);
    assert.equal(found.contract.source, "FULL_CHAIN");
  }

  const notFound = await selectOptionContract({
    symbol: "NVDA",
    direction: "CALL",
    strike: 500,
    expiration: "2026-08-21",
    deps: { fetchFullChain: fetchChain as never },
  });

  assert.equal(notFound.status, "WAIT_DATA");

  if (notFound.status === "WAIT_DATA") {
    assert.equal(notFound.reason, "EXACT_CONTRACT_NOT_FOUND");
    assert.ok(notFound.details?.reason);
  }
});