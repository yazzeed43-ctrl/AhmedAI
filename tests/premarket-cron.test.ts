import assert from "node:assert/strict";
import test from "node:test";

import {
  executePremarketCron,
  getNewYorkPremarketWindow,
  type PremarketCronDependencies,
} from "../lib/trading/premarket-cron-service";
import { TelegramDeliveryError } from "../lib/notifications/telegram-sender";
import { sendTelegramText } from "../lib/notifications/telegram-sender";
import {
  checkTradierMarketSession,
  findTradierMarketSession,
} from "../lib/trading/market-session-calendar";
import { classifyExistingPremarketClaim } from "../lib/trading/premarket-delivery-store";

const report = {
  stockScan: { dataStatus: "COMPLETE", outcome: "OPPORTUNITIES_FOUND" },
  spxwScan: { status: "NO_MATCH" },
};

function dependencies(overrides: Partial<PremarketCronDependencies> = {}) {
  const calls = { claim: 0, failed: 0, partial: 0, started: 0, unconfirmed: 0, saved: 0, mark: 0, scan: 0, send: 0 };
  const value: PremarketCronDependencies = {
    checkMarketSession: async () => ({ status: "OPEN" }),
    claimSession: async () => { calls.claim += 1; return "CLAIMED_NEW"; },
    saveSessionReport: async () => { calls.saved += 1; },
    markSessionFailed: async () => { calls.failed += 1; },
    markSessionPartial: async () => { calls.partial += 1; },
    markSessionDeliveryStarted: async () => { calls.started += 1; },
    markSessionDeliveryUnconfirmed: async () => { calls.unconfirmed += 1; },
    markSessionSent: async () => { calls.mark += 1; },
    scan: async () => { calls.scan += 1; return report as any; },
    format: () => "premarket report",
    send: async () => { calls.send += 1; return [{ messageId: 101 }]; },
    ...overrides,
  };
  return { calls, value };
}

test("accepts 08:45 New York during daylight saving time", () => {
  const result = getNewYorkPremarketWindow(new Date("2026-07-27T12:45:00Z"));
  assert.equal(result.shouldRun, true);
  assert.equal(result.sessionDate, "2026-07-27");
});

test("accepts 08:45 New York during standard time", () => {
  const result = getNewYorkPremarketWindow(new Date("2026-12-07T13:45:00Z"));
  assert.equal(result.shouldRun, true);
  assert.equal(result.sessionDate, "2026-12-07");
});

test("accepts a delayed cron invocation inside the protected premarket window", () => {
  const result = getNewYorkPremarketWindow(new Date("2026-07-27T12:52:00Z"));
  assert.equal(result.shouldRun, true);
});

test("rejects the second UTC slot when it is not 08:45 New York", async () => {
  const setup = dependencies();
  const result = await executePremarketCron({
    now: new Date("2026-07-27T13:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "SKIPPED_OUTSIDE_WINDOW");
  assert.equal(setup.calls.claim, 0);
  assert.equal(setup.calls.scan, 0);
});

test("a previously claimed session is not scanned or sent again", async () => {
  const setup = dependencies({ claimSession: async () => "ALREADY_SENT" });
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "SKIPPED_ALREADY_SENT");
  assert.equal(setup.calls.scan, 0);
  assert.equal(setup.calls.send, 0);
});

test("a successful session is scanned, sent, and marked exactly once", async () => {
  const setup = dependencies();
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "SENT");
  assert.deepEqual(result.messageIds, [101]);
  assert.equal(setup.calls.claim, 1);
  assert.equal(setup.calls.scan, 1);
  assert.equal(setup.calls.send, 1);
  assert.equal(setup.calls.mark, 1);
  assert.equal(setup.calls.failed, 0);
});

test("a send failure records FAILED so the session can retry", async () => {
  const setup = dependencies({
    send: async () => { throw new Error("Telegram unavailable"); },
  });
  await assert.rejects(
    executePremarketCron({
      now: new Date("2026-07-27T12:45:00Z"),
      dependencies: setup.value,
    }),
    /Telegram unavailable/,
  );
  assert.equal(setup.calls.mark, 0);
  assert.equal(setup.calls.failed, 1);
});

test("a ledger update failure after delivery becomes DELIVERY_UNCONFIRMED", async () => {
  const setup = dependencies({
    markSessionSent: async () => { throw new Error("database unavailable"); },
  });
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "DELIVERY_UNCONFIRMED");
  assert.equal(setup.calls.send, 1);
  assert.equal(setup.calls.failed, 0);
  assert.equal(setup.calls.unconfirmed, 1);
});

test("Thanksgiving is skipped before claiming or scanning", async () => {
  const setup = dependencies({
    checkMarketSession: async () => ({ status: "HOLIDAY", reason: "Thanksgiving Day" }),
  });
  const result = await executePremarketCron({
    now: new Date("2026-11-26T13:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "SKIPPED_HOLIDAY");
  assert.equal(setup.calls.claim, 0);
  assert.equal(setup.calls.scan, 0);
  assert.equal(setup.calls.send, 0);
});

test("an unverified market session fails closed before claiming", async () => {
  const setup = dependencies({
    checkMarketSession: async () => ({ status: "UNAVAILABLE", reason: "calendar timeout" }),
  });
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "SKIPPED_SESSION_UNVERIFIED");
  assert.equal(setup.calls.claim, 0);
});

test("a partial delivery is persisted and returned explicitly", async () => {
  const setup = dependencies({
    send: async () => { throw new TelegramDeliveryError("second chunk failed", [101], "DEFINITIVE"); },
  });
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "PARTIAL_DELIVERY");
  assert.deepEqual(result.messageIds, [101]);
  assert.equal(setup.calls.partial, 1);
});

test("failure to persist partial delivery never permits blind retry", async () => {
  const setup = dependencies({
    send: async () => { throw new TelegramDeliveryError("second chunk failed", [101], "DEFINITIVE"); },
    markSessionPartial: async () => { throw new Error("ledger unavailable"); },
  });
  await assert.rejects(executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  }), /ledger unavailable/);
  assert.equal(setup.calls.failed, 0);
});

test("scanner DATA_PROVIDER_ERROR still sends an operational report", async () => {
  const setup = dependencies({
    scan: async () => ({
      stockScan: { dataStatus: "DATA_PROVIDER_ERROR", outcome: "UNKNOWN" },
      spxwScan: { status: "DATA_PROVIDER_ERROR" },
    }) as any,
  });
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "SENT");
  assert.equal(result.stockDataStatus, "DATA_PROVIDER_ERROR");
  assert.equal(setup.calls.send, 1);
});

test("Tradier calendar parser recognizes an exchange holiday", () => {
  const result = findTradierMarketSession({
    calendar: { days: { day: [{
      date: "2026-11-26",
      status: "closed",
      description: "Thanksgiving Day",
    }] } },
  }, "2026-11-26");
  assert.deepEqual(result, { status: "HOLIDAY", reason: "Thanksgiving Day" });
});

test("market calendar sends the configured Tradier access token", async () => {
  let authorization = "";
  const result = await checkTradierMarketSession("2026-07-27", {
    token: "access-token",
    fetchImpl: async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({
        calendar: { days: { day: [{ date: "2026-07-27", status: "open" }] } },
      }), { status: 200 });
    },
  });
  assert.equal(authorization, "Bearer access-token");
  assert.deepEqual(result, { status: "OPEN" });
});

test("a fresh PROCESSING claim remains locked", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "PROCESSING",
    updatedAt: "2026-07-27T12:40:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "IN_PROGRESS");
});

test("a stale PROCESSING claim is reclaimable", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "PROCESSING",
    updatedAt: "2026-07-27T12:20:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "CLAIMED_STALE");
});

test("a SENT claim is never retried", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "SENT",
    updatedAt: "2026-07-27T10:00:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "ALREADY_SENT");
});

test("DELIVERY_STARTED is never reclaimed automatically", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "DELIVERY_STARTED",
    updatedAt: "2026-07-27T10:00:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "PARTIAL_REQUIRES_RECONCILIATION");
});

test("PARTIAL_DELIVERY requires reconciliation", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "PARTIAL_DELIVERY",
    updatedAt: "2026-07-27T10:00:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "PARTIAL_REQUIRES_RECONCILIATION");
});

test("DELIVERY_UNCONFIRMED requires reconciliation", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "DELIVERY_UNCONFIRMED",
    updatedAt: "2026-07-27T10:00:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "PARTIAL_REQUIRES_RECONCILIATION");
});

test("FAILED is reclaimable", () => {
  assert.equal(classifyExistingPremarketClaim({
    status: "FAILED",
    updatedAt: "2026-07-27T12:44:00Z",
    now: new Date("2026-07-27T12:45:00Z"),
  }), "CLAIMED_STALE");
});

test("Telegram retries a temporary 503 then succeeds", async () => {
  let attempts = 0;
  const result = await sendTelegramText({
    token: "token",
    chatId: "1",
    text: "report",
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ ok: false }), { status: 503 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), { status: 200 });
    },
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result, [{ messageId: 55 }]);
});

test("Telegram retries a network failure then succeeds", async () => {
  let attempts = 0;
  const result = await sendTelegramText({
    token: "token",
    chatId: "1",
    text: "report",
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network timeout");
      return new Response(JSON.stringify({ ok: true, result: { message_id: 57 } }), { status: 200 });
    },
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result, [{ messageId: 57 }]);
});

test("exhausted network failures become DELIVERY_UNCONFIRMED, never FAILED", async () => {
  const setup = dependencies({
    send: () => sendTelegramText({
      token: "token",
      chatId: "1",
      text: "report",
      sleep: async () => undefined,
      fetchImpl: async () => { throw new Error("network timeout"); },
    }),
  });
  const result = await executePremarketCron({
    now: new Date("2026-07-27T12:45:00Z"),
    dependencies: setup.value,
  });
  assert.equal(result.outcome, "DELIVERY_UNCONFIRMED");
  assert.equal(setup.calls.unconfirmed, 1);
  assert.equal(setup.calls.failed, 0);
});

test("Telegram respects retry_after for HTTP 429", async () => {
  const delays: number[] = [];
  let attempts = 0;
  await sendTelegramText({
    token: "token",
    chatId: "1",
    text: "report",
    sleep: async (delay) => { delays.push(delay); },
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ ok: false, parameters: { retry_after: 2 } }), { status: 429 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 56 } }), { status: 200 });
    },
  });
  assert.deepEqual(delays, [2000]);
});

test("Telegram does not retry a permanent 401", async () => {
  let attempts = 0;
  await assert.rejects(sendTelegramText({
    token: "token",
    chatId: "1",
    text: "report",
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    },
  }), /HTTP 401/);
  assert.equal(attempts, 1);
});
