// lib/trading/build-trigger-data.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTriggerData } from "./build-trigger-data";
import type { TriggerPlan } from "./candle-confirmation-core";
import type { LatestCompletedCandle } from "@/lib/market-indicators";

function makeStockResult(overrides: Record<string, any> = {}) {
  return {
    status: "READY",
    stock: {
      symbol: "NVDA",
      price: 190,
      ...(overrides.stock ?? {}),
    },
    triggerLevels: {
      price: 190,
      vwap: 189.5,
      poc: 188,
      vah: 192,
      val: 186,
      support: 185,
      resistance: 195,
      ...(overrides.triggerLevels ?? {}),
    },
  };
}

function makeCandle(
  overrides: Partial<LatestCompletedCandle> = {},
): LatestCompletedCandle {
  return {
    symbol: "NVDA",
    timeframe: "5min",
    startTime: "2026-07-28T13:30:00Z",
    endTime: "2026-07-28T13:35:00Z",
    open: 189,
    high: 191,
    low: 188.5,
    close: 190.5,
    isClosed: true,
    source: "Twelve Data",
    ...overrides,
  };
}

function makePlan(overrides: Partial<TriggerPlan> = {}): TriggerPlan {
  return {
    direction: "CALL",
    triggerPrice: 192,
    invalidationPrice: 185,
    ...overrides,
  };
}

describe("buildTriggerData", () => {
  it("1) STOCK_DATA WAIT_DATA يوقف فورًا قبل أي استدعاء آخر", async () => {
    let candleCalled = false;
    const fetchStock = async () => ({
      status: "WAIT_DATA" as const,
      reason: "SYMBOL_NOT_FOUND",
    });
    const fetchLatestCandle = async () => {
      candleCalled = true;
      return makeCandle();
    };

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "WAIT_DATA");
    if (result.status === "WAIT_DATA") {
      assert.equal(result.stage, "STOCK_DATA");
      assert.equal(result.reason, "SYMBOL_NOT_FOUND");
    }
    assert.equal(candleCalled, false);
  });

  it("2) بدون existingPlan: يبني خطة جديدة عبر buildStockTriggerPlan الحقيقية", async () => {
    const fetchStock = async () => makeStockResult() as any;
    const fetchLatestCandle = async () => makeCandle();

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "READY");
    if (result.status === "READY") {
      assert.equal(result.triggerPlan.direction, "CALL");
    }
  });

  it("3) مع existingPlan مطابقة الاتجاه: لا يُعاد البناء، تُستخدم كما هي حرفيًا", async () => {
    const fetchStock = async () => makeStockResult() as any;
    const fetchLatestCandle = async () => makeCandle();
    const existingPlan = makePlan({
      triggerPrice: 999,
      state: "PRICE_TOUCHED",
      priceTouchedAt: "2026-07-28T13:00:00Z",
    });

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      existingPlan,
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "READY");
    if (result.status === "READY") {
      assert.equal(result.triggerPlan, existingPlan); // نفس المرجع
      assert.equal(result.triggerPlan.triggerPrice, 999);
      assert.equal(
        result.triggerPlan.priceTouchedAt,
        "2026-07-28T13:00:00Z",
      );
    }
  });

  it("4) TRIGGER_PLAN WAIT_DATA حاسم: مستويات ناقصة بدون existingPlan", async () => {
    const fetchStock = async () =>
      makeStockResult({
        triggerLevels: {
          price: 190,
          vwap: null,
          poc: null,
          vah: null,
          val: null,
          support: null,
          resistance: null,
        },
      }) as any;
    let candleCalled = false;
    const fetchLatestCandle = async () => {
      candleCalled = true;
      return makeCandle();
    };

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "WAIT_DATA");
    if (result.status === "WAIT_DATA") {
      assert.equal(result.stage, "TRIGGER_PLAN");
    }
    assert.equal(candleCalled, false);
  });

  it("5) existingPlan تتجاوز buildStockTriggerPlan حتى مع triggerLevels ناقصة", async () => {
    const fetchStock = async () =>
      makeStockResult({
        triggerLevels: {
          price: 190,
          vwap: null,
          poc: null,
          vah: null,
          val: null,
          support: null,
          resistance: null,
        },
      }) as any;
    const fetchLatestCandle = async () => makeCandle();
    const existingPlan = makePlan();

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      existingPlan,
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "READY");
  });

  it("6) فشل جلب الشمعة → latestCandle=null + تحذير، بدون توقف المسار", async () => {
    const fetchStock = async () => makeStockResult() as any;
    const fetchLatestCandle = async () => {
      throw new Error("Twelve Data timeout");
    };
    const existingPlan = makePlan();

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      existingPlan,
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "READY");
    if (result.status === "READY") {
      assert.equal(result.latestCandle, null);
      assert.ok(
        result.warnings.includes(
          "تعذر جلب آخر شمعة 5 دقائق مكتملة؛ لا يمكن إصدار CANDLE_CONFIRMED.",
        ),
      );
    }
  });

  it("7) currentPrice يُبنى من stock.price وليس triggerLevels.price (سلوكي بدون Mock)", async () => {
    const fetchStock = async () =>
      makeStockResult({
        stock: { symbol: "NVDA", price: 201 },
        triggerLevels: { price: 190 },
      }) as any;
    const fetchLatestCandle = async () => makeCandle();
    const existingPlan = makePlan({ triggerPrice: 200 }); // 201>=200 لكن 190<200

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "CALL",
      existingPlan,
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "READY");
    if (result.status === "READY") {
      assert.notEqual(result.confirmation.state, "WAIT_TRIGGER");
    }
  });

  it("8) existingPlan باتجاه مختلف عن الطلب → WAIT_DATA بدل تجاهل التعارض", async () => {
    const fetchStock = async () => makeStockResult() as any;
    let candleCalled = false;
    const fetchLatestCandle = async () => {
      candleCalled = true;
      return makeCandle();
    };
    const existingPlan = makePlan({ direction: "CALL" });

    const result = await buildTriggerData({
      symbol: "NVDA",
      direction: "PUT", // تعارض متعمد
      existingPlan,
      deps: { fetchStock: fetchStock as any, fetchLatestCandle },
    });

    assert.equal(result.status, "WAIT_DATA");
    if (result.status === "WAIT_DATA") {
      assert.equal(result.stage, "TRIGGER_PLAN");
      assert.equal(
        result.reason,
        "اتجاه الخطة المحفوظة لا يطابق اتجاه الطلب الحالي",
      );
    }
    assert.equal(candleCalled, false); // توقف فورًا، ما وصلنا لمرحلة الشمعة
  });
});
