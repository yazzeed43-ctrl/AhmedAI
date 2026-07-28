// lib/trading/auto-trade-input-adapter.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDaysToExpiration,
  toRawOptionData,
  toEngineTriggerData,
  type ReadyBuildTriggerData,
} from "./auto-trade-input-adapter";
import type { SelectedOptionContract } from "./select-option-contract";

function makeSelectedContract(
  overrides: Partial<SelectedOptionContract> = {},
): SelectedOptionContract {
  return {
    source: "SCANNER",
    symbol: "NVDA",
    direction: "CALL",
    contractSymbol: "NVDA260807C00190000",
    expiration: "2026-08-07",
    strike: 190,
    bid: 2.1,
    ask: 2.2,
    last: 2.15,
    volume: 1200,
    openInterest: 5000,
    spreadPercent: 4.5,
    delta: 0.35,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.1,
    impliedVolatility: 0.4,
    raw: {} as any,
    ...overrides,
  };
}

function makeReadyTriggerData(
  overrides: Record<string, any> = {},
): ReadyBuildTriggerData {
  return {
    status: "READY",
    stock: {
      symbol: "NVDA",
      price: 190,
      vwap: 189,
      relativeVolume: 1.5,
      ...(overrides.stock ?? {}),
    },
    triggerLevels: {
      price: 190,
      ...(overrides.triggerLevels ?? {}),
    },
    triggerPlan: {
      direction: "CALL",
      triggerPrice: 192,
      invalidationPrice: 185,
      ...(overrides.triggerPlan ?? {}),
    },
    latestCandle:
      overrides.latestCandle === null
        ? null
        : overrides.latestCandle ?? {
            symbol: "NVDA",
            timeframe: "5min",
            startTime: "2026-07-28T13:30:00Z",
            endTime: "2026-07-28T13:35:00Z",
            open: 189,
            high: 193,
            low: 188.5,
            close: 192.5,
            isClosed: true,
            source: "Twelve Data",
          },
    confirmation: {
      state: "CANDLE_CONFIRMED",
      priceTouchedAt: "2026-07-28T13:30:00Z",
      confirmedCandle: null,
      ...(overrides.confirmation ?? {}),
    },
    warnings: [],
  } as ReadyBuildTriggerData;
}

describe("calculateDaysToExpiration", () => {
  it("1) يوم الاستحقاق نفسه = 0DTE بغض النظر عن الوقت الحالي", () => {
    const days = calculateDaysToExpiration(
      "2026-08-07",
      new Date("2026-08-07T20:00:00.000Z"), // آخر النهار بنفس اليوم
    );
    assert.equal(days, 0);
  });

  it("2) فرق تقويمي صحيح على مدى أيام متعددة", () => {
    const days = calculateDaysToExpiration(
      "2026-08-10",
      new Date("2026-08-07T00:00:00.000Z"),
    );
    assert.equal(days, 3);
  });

  it("3) لا يرجع رقم سالب بعد انتهاء العقد", () => {
    const days = calculateDaysToExpiration(
      "2026-08-01",
      new Date("2026-08-05T00:00:00.000Z"),
    );
    assert.equal(days, 0);
  });
});

describe("toRawOptionData", () => {
  it("4) symbol = contractSymbol وليس رمز الأصل", () => {
    const selected = makeSelectedContract();
    const result = toRawOptionData(
      selected,
      190,
      new Date("2026-07-28T00:00:00.000Z"),
    );
    assert.equal(result.symbol, "NVDA260807C00190000");
    assert.notEqual(result.symbol, "NVDA");
  });

  it("5) underlyingPrice يُمرر كما هو من المعامل المستقل", () => {
    const selected = makeSelectedContract();
    const result = toRawOptionData(
      selected,
      201.5,
      new Date("2026-07-28T00:00:00.000Z"),
    );
    assert.equal(result.underlyingPrice, 201.5);
  });

  it("6) daysToExpiration محسوبة صحيح من expiration + evaluatedAt", () => {
    const selected = makeSelectedContract({ expiration: "2026-08-07" });
    const result = toRawOptionData(
      selected,
      190,
      new Date("2026-08-05T00:00:00.000Z"),
    );
    assert.equal(result.daysToExpiration, 2);
  });

  it("7) الحقول اليونانية والسيولة تُنسخ حرفيًا بدون تحويل", () => {
    const selected = makeSelectedContract({
      delta: 0.42,
      openInterest: 777,
    });
    const result = toRawOptionData(
      selected,
      190,
      new Date("2026-07-28T00:00:00.000Z"),
    );
    assert.equal(result.delta, 0.42);
    assert.equal(result.openInterest, 777);
  });
});

describe("toEngineTriggerData", () => {
  it("8) CANDLE_CONFIRMED → confirmationStatus = CONFIRMED", () => {
    const triggerData = makeReadyTriggerData({
      confirmation: { state: "CANDLE_CONFIRMED" },
    });
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.confirmationStatus, "CONFIRMED");
  });

  it("9) CANCELLED → confirmationStatus = FAILED", () => {
    const triggerData = makeReadyTriggerData({
      confirmation: { state: "CANCELLED" },
    });
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.confirmationStatus, "FAILED");
  });

  it("10) WAIT_TRIGGER / PRICE_TOUCHED / WAIT_CANDLE_CLOSE → WAITING", () => {
    for (const state of [
      "WAIT_TRIGGER",
      "PRICE_TOUCHED",
      "WAIT_CANDLE_CLOSE",
    ] as const) {
      const triggerData = makeReadyTriggerData({ confirmation: { state } });
      const result = toEngineTriggerData(triggerData);
      assert.equal(result.confirmationStatus, "WAITING");
    }
  });

  it("11) candleClose من confirmedCandle أولاً لو موجودة", () => {
    const triggerData = makeReadyTriggerData({
      confirmation: {
        state: "CANDLE_CONFIRMED",
        confirmedCandle: { close: 195.5 },
      },
      latestCandle: { close: 192.5 },
    });
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.candleClose, 195.5);
  });

  it("12) candleClose يسقط إلى latestCandle.close لو ما فيه confirmedCandle", () => {
    const triggerData = makeReadyTriggerData({
      confirmation: { state: "WAIT_TRIGGER", confirmedCandle: null },
      latestCandle: { close: 192.5 },
    });
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.candleClose, 192.5);
  });

  it("13) candleClose يسقط إلى stock.price لو ما فيه شمعة إطلاقًا", () => {
    const triggerData = makeReadyTriggerData({
      confirmation: { state: "WAIT_TRIGGER", confirmedCandle: null },
      latestCandle: null,
      stock: { symbol: "NVDA", price: 188.5 },
    });
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.candleClose, 188.5);
  });

  it("14) previousCandleClose دائمًا null — لا اختراع بيانات", () => {
    const triggerData = makeReadyTriggerData();
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.previousCandleClose, null);
  });

  it("15) breakoutLevel لـ CALL وbreakdownLevel=null، والعكس لـ PUT", () => {
    const callTrigger = makeReadyTriggerData({
      triggerPlan: {
        direction: "CALL",
        triggerPrice: 200,
        invalidationPrice: 190,
      },
    });
    const callResult = toEngineTriggerData(callTrigger);
    assert.equal(callResult.breakoutLevel, 200);
    assert.equal(callResult.breakdownLevel, null);

    const putTrigger = makeReadyTriggerData({
      triggerPlan: {
        direction: "PUT",
        triggerPrice: 180,
        invalidationPrice: 190,
      },
      confirmation: { state: "WAIT_TRIGGER" },
    });
    const putResult = toEngineTriggerData(putTrigger);
    assert.equal(putResult.breakdownLevel, 180);
    assert.equal(putResult.breakoutLevel, null);
  });

  it("16) VWAP flags تكون undefined لو vwap غير متاح — لا نحسبها بقيمة وهمية", () => {
    const triggerData = makeReadyTriggerData({
      stock: { symbol: "NVDA", price: 190, vwap: null },
    });
    const result = toEngineTriggerData(triggerData);
    assert.equal(result.priceAboveVwap, undefined);
    assert.equal(result.priceBelowVwap, undefined);
  });

  it("17) relativeVolume يُمرر حرفيًا أو null — لا اختراع RVOL=1.2", () => {
    const withRvol = makeReadyTriggerData({
      stock: { symbol: "NVDA", price: 190, relativeVolume: 2.3 },
    });
    assert.equal(toEngineTriggerData(withRvol).relativeVolume, 2.3);

    const withoutRvol = makeReadyTriggerData({
      stock: { symbol: "NVDA", price: 190, relativeVolume: undefined },
    });
    assert.equal(toEngineTriggerData(withoutRvol).relativeVolume, null);
  });
});
