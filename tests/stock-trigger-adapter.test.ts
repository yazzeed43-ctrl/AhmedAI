import assert from "node:assert/strict";
import test from "node:test";
import { buildStockTriggerPlan } from "../lib/trading/stock-trigger-adapter";

test("CALL prefers resistance over VAH when both exist", () => {
  const result = buildStockTriggerPlan("CALL", {
    price: 100,
    resistance: 110,
    vah: 112,
    vwap: 98,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.triggerPrice, 110);
    assert.equal(result.plan.invalidationPrice, 98); // VWAP له الأولوية
  }
});

test("CALL falls back to VAH when resistance is missing", () => {
  const result = buildStockTriggerPlan("CALL", {
    price: 100,
    vah: 112,
    vwap: 98,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.triggerPrice, 112);
  }
});

test("PUT prefers support over VAL, and VWAP for invalidation", () => {
  const result = buildStockTriggerPlan("PUT", {
    price: 100,
    support: 90,
    val: 88,
    vwap: 102,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.triggerPrice, 90);
    assert.equal(result.plan.invalidationPrice, 102);
  }
});

test("CALL without VWAP uses POC when price is above POC", () => {
  const result = buildStockTriggerPlan("CALL", {
    price: 105,
    resistance: 110,
    poc: 100,
    val: 90,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.invalidationPrice, 100); // POC
  }
});

test("CALL without VWAP falls back to VAL when price is at/below POC", () => {
  const result = buildStockTriggerPlan("CALL", {
    price: 95,
    resistance: 110,
    poc: 100,
    val: 90,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.invalidationPrice, 90); // VAL
  }
});

test("PUT without VWAP uses POC when price is below POC", () => {
  const result = buildStockTriggerPlan("PUT", {
    price: 95,
    support: 90,
    poc: 100,
    vah: 110,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.invalidationPrice, 100); // POC
  }
});

test("PUT without VWAP falls back to VAH when price is at/above POC", () => {
  const result = buildStockTriggerPlan("PUT", {
    price: 105,
    support: 90,
    poc: 100,
    vah: 110,
  });

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.plan.invalidationPrice, 110); // VAH
  }
});

test("missing trigger level returns WAIT_DATA instead of inventing one", () => {
  const result = buildStockTriggerPlan("CALL", {
    price: 100,
    vwap: 98,
    // لا resistance ولا vah
  });

  assert.equal(result.status, "WAIT_DATA");
});

test("missing invalidation level returns WAIT_DATA instead of inventing one", () => {
  const result = buildStockTriggerPlan("PUT", {
    price: 100,
    support: 90,
    // لا vwap ولا poc ولا vah
  });

  assert.equal(result.status, "WAIT_DATA");
});

test("inconsistent levels (invalidation on the wrong side) return WAIT_DATA", () => {
  const result = buildStockTriggerPlan("CALL", {
    price: 100,
    resistance: 105,
    vwap: 110, // فوق مستوى التفعيل نفسه — غير منطقي لصفقة CALL
  });

  assert.equal(result.status, "WAIT_DATA");
});
