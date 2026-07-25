import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeTradierError,
  scanExpirationCandidates,
  summarizeExpirationScans,
} from "../lib/trading/spxw-scan-completeness";

const emptyChain = async () => [];

test("complete successful scans with no opportunities produce NO_MATCH", async () => {
  const results = await scanExpirationCandidates(
    ["2026-07-31", "2026-08-03"],
    emptyChain,
  );
  const summary = summarizeExpirationScans(results, 0);

  assert.equal(summary.status, "NO_MATCH");
  assert.equal(summary.expirationsRequested, 2);
  assert.equal(summary.expirationsSucceeded, 2);
  assert.equal(summary.expirationsFailed, 0);
  assert.deepEqual(summary.providerErrors, []);
});

test("complete successful scans with opportunities produce OPPORTUNITIES_FOUND", async () => {
  const results = await scanExpirationCandidates(["2026-07-31"], emptyChain);
  const summary = summarizeExpirationScans(results, 1);

  assert.equal(summary.status, "OPPORTUNITIES_FOUND");
  assert.equal(summary.expirationsFailed, 0);
});

test("all Tradier failures produce DATA_PROVIDER_ERROR", async () => {
  const results = await scanExpirationCandidates(
    ["2026-07-31", "2026-08-03"],
    async () => {
      throw new Error("Tradier 503: upstream response with sensitive details");
    },
  );
  const summary = summarizeExpirationScans(results, 0);

  assert.equal(summary.status, "DATA_PROVIDER_ERROR");
  assert.equal(summary.expirationsSucceeded, 0);
  assert.equal(summary.expirationsFailed, 2);
  assert.equal(summary.providerErrors[0].code, "HTTP_503");
  assert.equal(
    summary.providerErrors[0].message,
    "Tradier options chain request failed",
  );
  assert.doesNotMatch(JSON.stringify(summary.providerErrors), /sensitive details/);
});

test("mixed Tradier success and failure produce PARTIAL_DATA", async () => {
  const results = await scanExpirationCandidates(
    ["2026-07-31", "2026-08-03"],
    async (_symbol, expiration) => {
      if (expiration === "2026-08-03") throw new Error("network failure");
      return [];
    },
  );
  const summary = summarizeExpirationScans(results, 1);

  assert.equal(summary.status, "PARTIAL_DATA");
  assert.equal(summary.expirationsSucceeded, 1);
  assert.equal(summary.expirationsFailed, 1);
});

test("zero requested expirations fail closed with a neutral reason", () => {
  const summary = summarizeExpirationScans([], 0);

  assert.equal(summary.status, "DATA_PROVIDER_ERROR");
  assert.equal(summary.expirationsRequested, 0);
  assert.equal(summary.expirationsSucceeded, 0);
  assert.equal(summary.expirationsFailed, 0);
  assert.equal(summary.providerErrors[0].code, "NO_EXPIRATIONS_AVAILABLE");
});

test("scan counters always reconcile", async () => {
  const results = await scanExpirationCandidates(
    ["2026-07-31", "2026-08-03", "2026-08-04"],
    async (_symbol, expiration) => {
      if (expiration === "2026-08-03") throw new Error("failed");
      return [];
    },
  );
  const summary = summarizeExpirationScans(results, 0);

  assert.equal(
    summary.expirationsRequested,
    summary.expirationsSucceeded + summary.expirationsFailed,
  );
});

test("sanitized timeout errors do not expose provider response details", () => {
  const error = new Error("secret response body");
  error.name = "TimeoutError";
  const sanitized = sanitizeTradierError("2026-07-31", error);

  assert.equal(sanitized.code, "TIMEOUT");
  assert.equal(sanitized.message, "Tradier options chain request timed out");
  assert.doesNotMatch(JSON.stringify(sanitized), /secret response body/);
});
