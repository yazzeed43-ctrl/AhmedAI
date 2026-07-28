// lib/trading/auto-analyze-trade.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoAnalyzeTrade } from "./auto-analyze-trade";
import type { TriggerPlan } from "./candle-confirmation-core";

// ---------- Helpers ----------

function makeMarketReady(overrides: Record<string, any> = {}) {
  return {
    status: "READY",
    data: {
      spy: { price: 550 },
      qqq: { price: 470 },
      ...(overrides.data ?? {}),
    },
  };
}

function makeTriggerReady(overrides: Record<string, any> = {}) {
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
      priceTouchedAt: "2026-07-28T13:00:00Z",
      confirmedCandle: null,
      ...(overrides.confirmation ?? {}),
    },
    warnings: overrides.warnings ?? [],
  };
}

function makeSelectedContract(overrides: Record<string, any> = {}) {
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
    raw: {},
    ...overrides,
  };
}

function makeFakeReport(overrides: Record<string, any> = {}) {
  return {
    symbol: "NVDA",
    decision: "BUY_CALL",
    confidence: 82,
    ...overrides,
  };
}

describe("autoAnalyzeTrade", () => {
  it("1) فشل السوق يوقف كل ما بعده", async () => {
    let triggerCalled = false;
    let contractCalled = false;
    let engineCalled = false;

    const fetchMarket = async () => ({
      status: "WAIT_DATA" as const,
      reason: "SPY_PRICE_FAILED",
    });
    const buildTrigger = async () => {
      triggerCalled = true;
      return makeTriggerReady() as any;
    };
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => {
      engineCalled = true;
      return makeFakeReport() as any;
    };

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_DATA");
    if (result.status === "WAIT_DATA") {
      assert.equal(result.stage, "MARKET_DATA");
      assert.equal(result.reason, "SPY_PRICE_FAILED");
      assert.equal(result.marketData, null);
    }
    assert.equal(triggerCalled, false);
    assert.equal(contractCalled, false);
    assert.equal(engineCalled, false);
  });

  it("2) فشل buildTriggerData يوقف اختيار العقد", async () => {
    let contractCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () => ({
      status: "WAIT_DATA" as const,
      stage: "TRIGGER_PLAN" as const,
      reason: "TRIGGER_LEVELS_INSUFFICIENT",
      warnings: ["تحذير تجريبي"],
    });
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => makeFakeReport() as any;

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger: buildTrigger as any, selectContract, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_DATA");
    if (result.status === "WAIT_DATA") {
      assert.equal(result.stage, "TRIGGER_DATA");
      assert.equal(result.reason, "TRIGGER_LEVELS_INSUFFICIENT");
      assert.deepEqual(result.warnings, ["تحذير تجريبي"]);
      assert.notEqual(result.marketData, null); // السوق نجح، فقط التفعيل فشل
    }
    assert.equal(contractCalled, false);
  });

  it("3) WAIT_TRIGGER لا يستدعي اختيار العقد", async () => {
    let contractCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () =>
      makeTriggerReady({ confirmation: { state: "WAIT_TRIGGER" } }) as any;
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => makeFakeReport() as any;

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_TRIGGER");
    if (result.status === "WAIT_TRIGGER") {
      assert.equal(result.triggerData.confirmation.state, "WAIT_TRIGGER");
      assert.equal(result.selectedContract, null);
      assert.equal(result.report, null);
    }
    assert.equal(contractCalled, false);
  });

  it("4) PRICE_TOUCHED لا يستدعي اختيار العقد", async () => {
    let contractCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () =>
      makeTriggerReady({ confirmation: { state: "PRICE_TOUCHED" } }) as any;
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => makeFakeReport() as any;

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_TRIGGER");
    assert.equal(contractCalled, false);
  });

  it("5) WAIT_CANDLE_CLOSE لا يستدعي اختيار العقد", async () => {
    let contractCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () =>
      makeTriggerReady({ confirmation: { state: "WAIT_CANDLE_CLOSE" } }) as any;
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => makeFakeReport() as any;

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_TRIGGER");
    assert.equal(contractCalled, false);
  });

  it("6) CANCELLED لا يختار عقدًا ولا يشغل المحرك، وتبقى الحالة الأصلية واضحة داخل triggerData", async () => {
    let contractCalled = false;
    let engineCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () =>
      makeTriggerReady({ confirmation: { state: "CANCELLED" } }) as any;
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => {
      engineCalled = true;
      return makeFakeReport() as any;
    };

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_TRIGGER");
    if (result.status === "WAIT_TRIGGER") {
      // الحالة الأصلية (CANCELLED) متاحة بوضوح هنا بدون اختراع حالة خارجية رابعة
      assert.equal(result.triggerData.confirmation.state, "CANCELLED");
    }
    assert.equal(contractCalled, false);
    assert.equal(engineCalled, false);
  });

  it("7) CANDLE_CONFIRMED يستدعي اختيار العقد", async () => {
    let contractCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () =>
      makeTriggerReady({ confirmation: { state: "CANDLE_CONFIRMED" } }) as any;
    const selectContract = async () => {
      contractCalled = true;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => makeFakeReport() as any;

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    assert.equal(contractCalled, true);
    assert.equal(result.status, "COMPLETED");
  });

  it("8) فشل اختيار العقد يرجع OPTION_CONTRACT مع دمج warnings الاثنين", async () => {
    let engineCalled = false;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () =>
      makeTriggerReady({ warnings: ["تحذير من buildTriggerData"] }) as any;
    const selectContract = async () => ({
      status: "WAIT_DATA" as const,
      reason: "EXACT_CONTRACT_NOT_FOUND",
      warnings: ["تحذير من selectOptionContract"],
    });
    const runEngine = () => {
      engineCalled = true;
      return makeFakeReport() as any;
    };

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract: selectContract as any, runEngine: runEngine as any },
    });

    assert.equal(result.status, "WAIT_DATA");
    if (result.status === "WAIT_DATA") {
      assert.equal(result.stage, "OPTION_CONTRACT");
      assert.equal(result.reason, "EXACT_CONTRACT_NOT_FOUND");
      assert.deepEqual(result.warnings, [
        "تحذير من buildTriggerData",
        "تحذير من selectOptionContract",
      ]);
      assert.notEqual(result.triggerData, null); // التفعيل نجح، فقط اختيار العقد فشل
    }
    assert.equal(engineCalled, false);
  });

  it("9) النجاح يشغل runTradeEngine مرة واحدة بمدخل محوّل صحيح", async () => {
    let engineCallCount = 0;
    let capturedInput: any = null;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async () => makeTriggerReady() as any;
    const selectContract = async () => ({
      status: "READY" as const,
      contract: makeSelectedContract(),
      warnings: [],
    });
    const runEngine = (engineInput: any) => {
      engineCallCount += 1;
      capturedInput = engineInput;
      return makeFakeReport() as any;
    };

    const result = await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract: selectContract as any, runEngine: runEngine as any },
    });

    assert.equal(engineCallCount, 1);
    assert.equal(result.status, "COMPLETED");

    // تأكيد المدخل المحوّل فعليًا صحيح، لا نص وسيط
    assert.equal(capturedInput.option.symbol, "NVDA260807C00190000"); // contractSymbol
    assert.equal(capturedInput.option.underlyingPrice, 190); // stock.price
    assert.equal(capturedInput.trigger.confirmationStatus, "CONFIRMED");
    assert.equal(capturedInput.trigger.breakoutLevel, 192); // triggerPlan.triggerPrice لـ CALL
    assert.equal(capturedInput.market.spy.price, 550);
    assert.equal(capturedInput.stock.symbol, "NVDA");

    if (result.status === "COMPLETED") {
      assert.equal(result.report.decision, "BUY_CALL");
    }
  });

  it("10) existingPlan وevaluatedAt وstrike/expiration تُمرر للمكونات الصحيحة دون تغيير", async () => {
    const existingPlan: TriggerPlan = {
      direction: "CALL",
      triggerPrice: 195,
      invalidationPrice: 188,
      state: "PRICE_TOUCHED",
      priceTouchedAt: "2026-07-28T12:00:00Z",
    };
    const evaluatedAt = new Date("2026-07-28T13:45:00.000Z");

    let capturedTriggerArgs: any = null;
    let capturedContractArgs: any = null;

    const fetchMarket = async () => makeMarketReady() as any;
    const buildTrigger = async (args: any) => {
      capturedTriggerArgs = args;
      return makeTriggerReady() as any;
    };
    const selectContract = async (args: any) => {
      capturedContractArgs = args;
      return { status: "READY", contract: makeSelectedContract(), warnings: [] } as any;
    };
    const runEngine = () => makeFakeReport() as any;

    await autoAnalyzeTrade({
      symbol: "NVDA",
      direction: "CALL",
      strike: 200,
      expiration: "2026-08-21",
      existingPlan,
      evaluatedAt,
      deps: { fetchMarket: fetchMarket as any, buildTrigger, selectContract, runEngine: runEngine as any },
    });

    // existingPlan وevaluatedAt يصلان لـ buildTriggerData كما هي بدون تحويل
    assert.equal(capturedTriggerArgs.existingPlan, existingPlan);
    assert.equal(capturedTriggerArgs.evaluatedAt, evaluatedAt);
    assert.equal(capturedTriggerArgs.symbol, "NVDA");
    assert.equal(capturedTriggerArgs.direction, "CALL");

    // strike وexpiration يصلان لـ selectOptionContract كما هي، لا fetchMarketData()
    assert.equal(capturedContractArgs.strike, 200);
    assert.equal(capturedContractArgs.expiration, "2026-08-21");
    assert.equal(capturedContractArgs.symbol, "NVDA");
    assert.equal(capturedContractArgs.direction, "CALL");
  });
});
