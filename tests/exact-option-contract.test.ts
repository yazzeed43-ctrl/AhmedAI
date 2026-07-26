import assert from "node:assert/strict";
import test from "node:test";
import type { OptionContract } from "../lib/tradier";
import {
  findExactOptionContract,
  parseOccOptionSymbol,
} from "../lib/trading/exact-option-contract";

function contract(
  symbol: string,
  strike: number,
  optionType: "call" | "put" = "call",
): OptionContract {
  return {
    symbol,
    strike,
    option_type: optionType,
    expiration_date: "2026-08-21",
    bid: 1,
    ask: 1.2,
    last: 1.1,
    volume: 100,
    open_interest: 500,
    spread_pct: 18.18,
    liquidity_quality: "جيد",
    liquidity_reason: "اختبار",
  };
}

test("finds an exact OCC contract beyond the first 12 contracts", () => {
  const contracts = Array.from({ length: 15 }, (_, index) =>
    contract(`IBM260821C${String((280 + index) * 1000).padStart(8, "0")}`, 280 + index),
  );
  const wanted = contract("IBM260821C00300000", 300);
  contracts.push(wanted);

  const result = findExactOptionContract(contracts, {
    contractSymbol: "IBM260821C00300000",
  });

  assert.equal(result.status, "FOUND");
  assert.equal(result.searchedContracts, 16);
  assert.equal(result.contract?.symbol, wanted.symbol);
});

test("parses an OCC symbol and rejects impossible calendar dates", () => {
  assert.deepEqual(parseOccOptionSymbol("ibm260918c00300000"), {
    underlying: "IBM",
    expiration: "2026-09-18",
    optionType: "call",
    strike: 300,
  });
  assert.equal(parseOccOptionSymbol("IBM260231C00300000"), null);
});

test("matches the exact structured contract", () => {
  const result = findExactOptionContract(
    [contract("IBM260821P00300000", 300, "put")],
    {
      underlying: "IBM",
      expiration: "2026-08-21",
      optionType: "put",
      strike: 300,
    },
  );

  assert.equal(result.status, "FOUND");
  assert.equal(result.contract?.strike, 300);
});

test("does not substitute a nearby strike when the exact contract is absent", () => {
  const result = findExactOptionContract(
    [contract("IBM260821C00295000", 295), contract("IBM260821C00305000", 305)],
    {
      underlying: "IBM",
      expiration: "2026-08-21",
      optionType: "call",
      strike: 300,
    },
  );

  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.contract, null);
  if (result.status !== "NOT_FOUND") {
    assert.fail("Expected NOT_FOUND");
  }
  assert.match(result.reason, /لم يتم استبداله/);
  assert.deepEqual(result.nearestAvailableStrikes, [295, 305]);
});

test("nearby strikes are diagnostic-only and limited to the same option type", () => {
  const result = findExactOptionContract(
    [
      contract("IBM260821C00290000", 290),
      contract("IBM260821P00295000", 295, "put"),
      contract("IBM260821C00310000", 310),
    ],
    {
      underlying: "IBM",
      expiration: "2026-08-21",
      optionType: "call",
      strike: 300,
    },
  );

  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.nearestAvailableStrikes, [290, 310]);
  assert.equal(result.contract, null);
  assert.deepEqual(result.availableStrikeRange, { min: 290, max: 310 });
});

test("structured lookup never matches a different underlying", () => {
  const result = findExactOptionContract(
    [contract("AAPL260821C00300000", 300)],
    {
      underlying: "IBM",
      expiration: "2026-08-21",
      optionType: "call",
      strike: 300,
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.contract, null);
});

test("call and put at the same strike do not cross-match", () => {
  const result = findExactOptionContract(
    [contract("IBM260821P00300000", 300, "put")],
    {
      underlying: "IBM",
      expiration: "2026-08-21",
      optionType: "call",
      strike: 300,
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.availableStrikeRange, { min: null, max: null });
});

test("a valid OCC symbol that is absent returns NOT_FOUND", () => {
  const result = findExactOptionContract([], {
    contractSymbol: "IBM260821C00300000",
  });
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.searchedContracts, 0);
});

test("structured input rejects an impossible calendar date", () => {
  const result = findExactOptionContract(
    [contract("IBM260821C00300000", 300)],
    {
      underlying: "IBM",
      expiration: "2026-02-31",
      optionType: "call",
      strike: 300,
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.searchedContracts, 0);
  if (result.status !== "NOT_FOUND") {
    assert.fail("Expected NOT_FOUND");
  }
  assert.match(result.reason, /غير صالحة/);
});

test("available strike diagnostics exclude a different expiration", () => {
  const otherExpiration = {
    ...contract("IBM260918C00100000", 100),
    expiration_date: "2026-09-18",
  };
  const result = findExactOptionContract(
    [contract("IBM260821C00290000", 290), otherExpiration],
    {
      underlying: "IBM",
      expiration: "2026-08-21",
      optionType: "call",
      strike: 300,
    },
  );

  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.availableStrikeRange, { min: 290, max: 290 });
  assert.deepEqual(result.nearestAvailableStrikes, [290]);
});
