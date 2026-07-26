import assert from "node:assert/strict";
import test from "node:test";
import { deriveTradierScanCompletion } from "../lib/trading/tradier-scanner-core/completeness";

const derive = (
  overrides: Partial<Parameters<typeof deriveTradierScanCompletion>[0]> = {},
) =>
  deriveTradierScanCompletion({
    symbolsRequested: 2,
    symbolsWithAnySuccess: 2,
    symbolsFailedCompletely: 0,
    expirationsRequested: 4,
    expirationsSucceeded: 4,
    expirationsFailed: 0,
    opportunityCount: 1,
    ...overrides,
  });

test("complete data with opportunities exposes the new API contract", () => {
  const result = derive();
  assert.deepEqual(result, {
    dataStatus: "COMPLETE",
    outcome: "OPPORTUNITIES_FOUND",
    diagnostic: "NONE",
  });
  assert.equal("status" in result, false);
});

test("complete data without opportunities is a known empty outcome", () => {
  assert.deepEqual(derive({ opportunityCount: 0 }), {
    dataStatus: "COMPLETE",
    outcome: "NO_OPPORTUNITIES",
    diagnostic: "NONE",
  });
});

test("success and failure inside one symbol produces PARTIAL_DATA", () => {
  assert.deepEqual(
    derive({
      symbolsRequested: 1,
      symbolsWithAnySuccess: 1,
      expirationsRequested: 2,
      expirationsSucceeded: 1,
      expirationsFailed: 1,
    }),
    {
      dataStatus: "PARTIAL_DATA",
      outcome: "OPPORTUNITIES_FOUND",
      diagnostic: "NONE",
    },
  );
});

test("one successful symbol and one completely failed symbol is partial", () => {
  assert.equal(
    derive({
      symbolsWithAnySuccess: 1,
      symbolsFailedCompletely: 1,
      expirationsRequested: 2,
      expirationsSucceeded: 1,
      expirationsFailed: 1,
    }).dataStatus,
    "PARTIAL_DATA",
  );
});

test("all expirations failed produces an unknown fatal outcome", () => {
  assert.deepEqual(
    derive({
      symbolsWithAnySuccess: 0,
      symbolsFailedCompletely: 2,
      expirationsSucceeded: 0,
      expirationsFailed: 4,
      opportunityCount: 3,
    }),
    {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "NO_SUCCESSFUL_EXPIRATIONS",
    },
  );
});

test("negative or fractional counters are invalid", () => {
  assert.equal(derive({ opportunityCount: -1 }).diagnostic, "INVALID_COUNTER");
  assert.equal(
    derive({ expirationsRequested: 3.5 }).diagnostic,
    "INVALID_COUNTER",
  );
});

test("symbol counters must reconcile", () => {
  assert.equal(
    derive({ symbolsFailedCompletely: 1 }).diagnostic,
    "SYMBOL_COUNTER_MISMATCH",
  );
});

test("expiration counters must reconcile", () => {
  assert.equal(
    derive({ expirationsFailed: 1 }).diagnostic,
    "EXPIRATION_COUNTER_MISMATCH",
  );
});

test("an empty request has its own diagnostic", () => {
  assert.deepEqual(
    derive({
      symbolsRequested: 0,
      symbolsWithAnySuccess: 0,
      expirationsRequested: 0,
      expirationsSucceeded: 0,
      opportunityCount: 0,
    }),
    {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "EMPTY_REQUEST",
    },
  );
});

test("successful symbols cannot exceed successful expirations", () => {
  assert.equal(
    derive({
      symbolsRequested: 2,
      symbolsWithAnySuccess: 2,
      symbolsFailedCompletely: 0,
      expirationsRequested: 1,
      expirationsSucceeded: 1,
      expirationsFailed: 0,
    }).diagnostic,
    "SYMBOL_COUNTER_MISMATCH",
  );
});
