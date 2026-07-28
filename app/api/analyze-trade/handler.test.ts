import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  handleAnalyzeTradeRequest,
} from "./handler";

import type {
  TradeEngineInput,
  TradeEngineReport,
} from "@/lib/trading/trade-engine";

import type {
  AutoAnalyzeTradeResult,
} from "@/lib/trading/auto-analyze-trade";

function makeManualInput(): TradeEngineInput {
  return {
    market: {
      spy: {
        price: 500,
        vwap: 499,
        ema20: 498,
        ema50: 497,
      },
      qqq: {
        price: 450,
        vwap: 449,
        ema20: 448,
        ema50: 447,
      },
    },
    stock: {
      symbol: "NVDA",
      price: 190,
      vwap: 189,
    },
    option: {
      symbol: "NVDA260807C00190000",
      strike: 190,
      optionType: "CALL",
      expiration: "2026-08-07",
      underlyingPrice: 190,
      daysToExpiration: 10,
    },
    trigger: {
      direction: "CALL",
      candleClose: 192,
      confirmationStatus: "CONFIRMED",
    },
  };
}

function makeReport(
  overrides: Partial<TradeEngineReport> = {},
): TradeEngineReport {
  return {
    symbol: "NVDA",
    contract: {
      optionType: "CALL",
      strike: 190,
      expiration: "2026-08-07",
      daysToExpiration: 10,
    },
    scores: {
      market: 80,
      stock: 75,
      options: 70,
      trade: 76,
    },
    optionQuality: {
      score: 70,
      label: "GOOD",
      components: {
        liquidity: 70,
        spread: 70,
        delta: 70,
        theta: 70,
        iv: 70,
        expiration: 70,
        proximity: 70,
      },
      strengths: [],
      weaknesses: [],
    },
    directions: {
      market: "CALL",
      stock: "CALL",
    },
    trigger: "CONFIRMED",
    alignment: true,
    decision: "BUY_CALL",
    confidence: 76,
    reasons: [],
    warnings: [],
    summary: "report",
    ...overrides,
  };
}

describe("handleAnalyzeTradeRequest", () => {
  it("1) يحافظ على MANUAL القديم بدون mode", async () => {
    let manualCalled = 0;

    const result = await handleAnalyzeTradeRequest(
      makeManualInput(),
      {
        runManual: () => {
          manualCalled += 1;
          return makeReport();
        },
        applySocial: async (report) => report,
        now: () => new Date("2026-07-28T12:00:00.000Z"),
      },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.mode, "MANUAL");
    assert.equal(manualCalled, 1);
  });

  it("2) يقبل MANUAL مع mode صريح", async () => {
    const result = await handleAnalyzeTradeRequest(
      {
        mode: "MANUAL",
        ...makeManualInput(),
      },
      {
        runManual: () => makeReport(),
        applySocial: async (report) => report,
      },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "MANUAL");
  });

  it("3) MANUAL غير صالح يرجع 400", async () => {
    const result = await handleAnalyzeTradeRequest({
      stock: {
        symbol: "NVDA",
        price: 190,
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "INVALID_INPUT");
  });

  it("4) AUTO غير صالح يرجع 400", async () => {
    const result = await handleAnalyzeTradeRequest({
      mode: "AUTO",
      symbol: "",
      direction: "CALL",
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "INVALID_AUTO_INPUT");
  });

  it("5) AUTO WAIT_DATA يرجع 200 ولا يطبق Social Intelligence", async () => {
    let socialCalled = false;

    const autoResult: AutoAnalyzeTradeResult = {
      status: "WAIT_DATA",
      stage: "MARKET_DATA",
      reason: "NO_MARKET_DATA",
      marketData: null,
      triggerData: null,
      selectedContract: null,
      report: null,
      warnings: [],
    };

    const result = await handleAnalyzeTradeRequest(
      {
        mode: "AUTO",
        symbol: "NVDA",
        direction: "CALL",
      },
      {
        runAuto: async () => autoResult,
        applySocial: async (report) => {
          socialCalled = true;
          return report;
        },
      },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.mode, "AUTO");

    const bodyResult = result.body.result as AutoAnalyzeTradeResult;
    assert.equal(bodyResult.status, "WAIT_DATA");
    assert.equal(socialCalled, false);
  });

  it("6) AUTO WAIT_TRIGGER يرجع 200", async () => {
    const autoResult = {
      status: "WAIT_TRIGGER",
      marketData: {
        spy: { price: 500 },
        qqq: { price: 450 },
      },
      triggerData: {
        status: "READY",
        stock: {
          symbol: "NVDA",
          price: 190,
        },
        triggerLevels: {
          price: 190,
        },
        triggerPlan: {
          direction: "CALL",
          triggerPrice: 192,
          invalidationPrice: 185,
        },
        latestCandle: null,
        confirmation: {
          state: "WAIT_TRIGGER",
          priceTouchedAt: null,
          confirmedCandle: null,
        },
        warnings: [],
      },
      selectedContract: null,
      report: null,
      warnings: [],
    } as AutoAnalyzeTradeResult;

    const result = await handleAnalyzeTradeRequest(
      {
        mode: "AUTO",
        symbol: "NVDA",
        direction: "CALL",
      },
      {
        runAuto: async () => autoResult,
      },
    );

    assert.equal(result.status, 200);

    const bodyResult = result.body.result as AutoAnalyzeTradeResult;
    assert.equal(bodyResult.status, "WAIT_TRIGGER");
  });

  it("7) AUTO COMPLETED يطبق Social Intelligence على التقرير فقط", async () => {
    const baseReport = makeReport({
      summary: "base",
    });

    const adjustedReport = makeReport({
      summary: "adjusted",
    });

    const autoResult = {
      status: "COMPLETED",
      marketData: {
        spy: { price: 500 },
        qqq: { price: 450 },
      },
      triggerData: {
        status: "READY",
        stock: {
          symbol: "NVDA",
          price: 190,
        },
        triggerLevels: {
          price: 190,
        },
        triggerPlan: {
          direction: "CALL",
          triggerPrice: 192,
          invalidationPrice: 185,
        },
        latestCandle: null,
        confirmation: {
          state: "CANDLE_CONFIRMED",
          priceTouchedAt: "2026-07-28T13:30:00.000Z",
          confirmedCandle: null,
        },
        warnings: [],
      },
      selectedContract: {
        source: "SCANNER",
        symbol: "NVDA",
        direction: "CALL",
        contractSymbol: "NVDA260807C00190000",
        expiration: "2026-08-07",
        strike: 190,
        bid: 2.1,
        ask: 2.2,
        last: 2.15,
        volume: 100,
        openInterest: 1000,
        spreadPercent: 4.5,
        delta: 0.5,
        gamma: 0.02,
        theta: -0.05,
        vega: 0.1,
        impliedVolatility: 0.4,
        raw: {} as any,
      },
      report: baseReport,
      warnings: [],
    } as AutoAnalyzeTradeResult;

    let receivedReport: TradeEngineReport | null = null;

    const result = await handleAnalyzeTradeRequest(
      {
        mode: "AUTO",
        symbol: "NVDA",
        direction: "CALL",
      },
      {
        runAuto: async () => autoResult,
        applySocial: async (report) => {
          receivedReport = report;
          return adjustedReport;
        },
        now: () => new Date("2026-07-28T12:00:00.000Z"),
      },
    );

    assert.equal(receivedReport, baseReport);
    assert.equal(result.status, 200);

    const bodyResult = result.body.result as {
      status: "COMPLETED";
      report: TradeEngineReport;
    };

    assert.equal(bodyResult.report.summary, "adjusted");
    assert.equal(
      result.body.generatedAt,
      "2026-07-28T12:00:00.000Z",
    );
  });

  it("8) AUTO ينظف symbol وtimeframe ويمرر الحقول الاختيارية", async () => {
    let receivedInput: unknown = null;

    const autoResult: AutoAnalyzeTradeResult = {
      status: "WAIT_DATA",
      stage: "MARKET_DATA",
      reason: "STOP",
      marketData: null,
      triggerData: null,
      selectedContract: null,
      report: null,
      warnings: [],
    };

    await handleAnalyzeTradeRequest(
      {
        mode: "AUTO",
        symbol: " nvda ",
        direction: "CALL",
        timeframe: " 5min ",
        strike: 190,
        expiration: "2026-08-07",
      },
      {
        runAuto: async (input) => {
          receivedInput = input;
          return autoResult;
        },
      },
    );

    assert.deepEqual(receivedInput, {
      symbol: "NVDA",
      direction: "CALL",
      timeframe: "5min",
      strike: 190,
      expiration: "2026-08-07",
      existingPlan: undefined,
    });
  });
});