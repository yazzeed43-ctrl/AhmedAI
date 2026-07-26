import assert from "node:assert/strict";
import test from "node:test";
import { deriveTradierScanStatus } from "../lib/trading/tradier-scanner-core/completeness";

test("some successful and some failed symbols produce PARTIAL_DATA", () => {
  assert.equal(
    deriveTradierScanStatus({
      symbolsRequested: 3,
      symbolsSucceeded: 2,
      symbolsFailed: 1,
      opportunityCount: 2,
    }),
    "PARTIAL_DATA",
  );
});

test("a complete scan without opportunities produces NO_MATCH", () => {
  assert.equal(
    deriveTradierScanStatus({
      symbolsRequested: 3,
      symbolsSucceeded: 3,
      symbolsFailed: 0,
      opportunityCount: 0,
    }),
    "NO_MATCH",
  );
});

test("all failed or unreconciled counters produce DATA_PROVIDER_ERROR", () => {
  assert.equal(
    deriveTradierScanStatus({
      symbolsRequested: 3,
      symbolsSucceeded: 0,
      symbolsFailed: 3,
      opportunityCount: 0,
    }),
    "DATA_PROVIDER_ERROR",
  );
  assert.equal(
    deriveTradierScanStatus({
      symbolsRequested: 3,
      symbolsSucceeded: 2,
      symbolsFailed: 0,
      opportunityCount: 0,
    }),
    "DATA_PROVIDER_ERROR",
  );
});
