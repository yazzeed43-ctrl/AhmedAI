import {
  runTradeEngine,
  type TradeEngineInput,
  type TradeEngineReport,
} from "@/lib/trading/trade-engine";

import {
  autoAnalyzeTrade,
  type AutoAnalyzeTradeInput,
  type AutoAnalyzeTradeResult,
} from "@/lib/trading/auto-analyze-trade";

import type { TriggerPlan } from "@/lib/trading/candle-confirmation-core";

import {
  applySocialIntelligenceToTradeReport,
} from "@/lib/social/social-decision-context";

type AutoRequestBody = {
  mode: "AUTO";
  symbol: string;
  direction: "CALL" | "PUT";
  timeframe?: string;
  strike?: number;
  expiration?: string;
  existingPlan?: TriggerPlan;
};

export type AnalyzeTradeHandlerResponse = {
  status: number;
  body: Record<string, unknown>;
};

export type AnalyzeTradeHandlerDeps = {
  runManual?: typeof runTradeEngine;
  runAuto?: typeof autoAnalyzeTrade;
  applySocial?: (
    report: TradeEngineReport,
  ) => Promise<TradeEngineReport>;
  now?: () => Date;
};

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function validateManualInput(
  input: unknown,
): input is TradeEngineInput {
  if (!isObject(input)) {
    return false;
  }

  const data = input as unknown as Partial<TradeEngineInput>;

  if (
    !data.market ||
    !data.stock ||
    !data.option ||
    !data.trigger
  ) {
    return false;
  }

  if (!data.market.spy || !data.market.qqq) {
    return false;
  }

  if (
    !isValidNumber(data.market.spy.price) ||
    !isValidNumber(data.market.qqq.price)
  ) {
    return false;
  }

  if (
    typeof data.stock.symbol !== "string" ||
    data.stock.symbol.trim().length === 0 ||
    !isValidNumber(data.stock.price)
  ) {
    return false;
  }

  if (
    typeof data.option.symbol !== "string" ||
    data.option.symbol.trim().length === 0 ||
    !isValidNumber(data.option.strike) ||
    !isValidNumber(data.option.underlyingPrice) ||
    !isValidNumber(data.option.daysToExpiration)
  ) {
    return false;
  }

  if (
    data.option.optionType !== "CALL" &&
    data.option.optionType !== "PUT"
  ) {
    return false;
  }

  if (
    data.trigger.direction !== "CALL" &&
    data.trigger.direction !== "PUT" &&
    data.trigger.direction !== "NEUTRAL"
  ) {
    return false;
  }

  return isValidNumber(data.trigger.candleClose);
}

function validateExistingPlan(
  value: unknown,
  direction: "CALL" | "PUT",
): value is TriggerPlan {
  if (!isObject(value)) {
    return false;
  }

  if (value.direction !== direction) {
    return false;
  }

  if (
    !isValidNumber(value.triggerPrice) ||
    !isValidNumber(value.invalidationPrice)
  ) {
    return false;
  }

  if (
    value.state !== undefined &&
    value.state !== "WAIT_TRIGGER" &&
    value.state !== "PRICE_TOUCHED" &&
    value.state !== "WAIT_CANDLE_CLOSE" &&
    value.state !== "CANDLE_CONFIRMED" &&
    value.state !== "CANCELLED"
  ) {
    return false;
  }

  if (
    value.priceTouchedAt !== undefined &&
    value.priceTouchedAt !== null &&
    typeof value.priceTouchedAt !== "string"
  ) {
    return false;
  }

  return true;
}

function validateAutoInput(
  input: unknown,
): input is AutoRequestBody {
  if (!isObject(input) || input.mode !== "AUTO") {
    return false;
  }

  const symbol =
    typeof input.symbol === "string"
      ? input.symbol.trim().toUpperCase()
      : "";

  if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) {
    return false;
  }

  if (
    input.direction !== "CALL" &&
    input.direction !== "PUT"
  ) {
    return false;
  }

  if (
    input.timeframe !== undefined &&
    (typeof input.timeframe !== "string" ||
      input.timeframe.trim().length === 0)
  ) {
    return false;
  }

  if (
    input.strike !== undefined &&
    (!isValidNumber(input.strike) || input.strike <= 0)
  ) {
    return false;
  }

  if (
    input.expiration !== undefined &&
    (typeof input.expiration !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.expiration))
  ) {
    return false;
  }

  if (
    input.existingPlan !== undefined &&
    !validateExistingPlan(
      input.existingPlan,
      input.direction,
    )
  ) {
    return false;
  }

  return true;
}

async function defaultApplySocial(
  report: TradeEngineReport,
): Promise<TradeEngineReport> {
  try {
    return await applySocialIntelligenceToTradeReport(
      report,
      {
        minutes: 1440,
        limit: 50,
      },
    );
  } catch (error) {
    console.error(
      "Social intelligence adjustment failed:",
      error,
    );

    return report;
  }
}

export async function handleAnalyzeTradeRequest(
  input: unknown,
  deps: AnalyzeTradeHandlerDeps = {},
): Promise<AnalyzeTradeHandlerResponse> {
  const runManual = deps.runManual ?? runTradeEngine;
  const runAuto = deps.runAuto ?? autoAnalyzeTrade;
  const applySocial =
    deps.applySocial ?? defaultApplySocial;
  const now = deps.now ?? (() => new Date());

  if (isObject(input) && input.mode === "AUTO") {
    if (!validateAutoInput(input)) {
      return {
        status: 400,
        body: {
          success: false,
          error: "INVALID_AUTO_INPUT",
          message:
            "بيانات التحليل الآلي غير مكتملة أو غير صالحة.",
        },
      };
    }

    const autoInput: AutoAnalyzeTradeInput = {
      symbol: input.symbol.trim().toUpperCase(),
      direction: input.direction,
      timeframe: input.timeframe?.trim(),
      strike: input.strike,
      expiration: input.expiration,
      existingPlan: input.existingPlan,
    };

    const result: AutoAnalyzeTradeResult =
      await runAuto(autoInput);

    if (result.status !== "COMPLETED") {
      return {
        status: 200,
        body: {
          success: true,
          mode: "AUTO",
          generatedAt: now().toISOString(),
          result,
        },
      };
    }

    const report = await applySocial(result.report);

    return {
      status: 200,
      body: {
        success: true,
        mode: "AUTO",
        generatedAt: now().toISOString(),
        result: {
          ...result,
          report,
        },
      },
    };
  }

  const manualInput =
    isObject(input) && input.mode === "MANUAL"
      ? Object.fromEntries(
          Object.entries(input).filter(
            ([key]) => key !== "mode",
          ),
        )
      : input;

  if (!validateManualInput(manualInput)) {
    return {
      status: 400,
      body: {
        success: false,
        error: "INVALID_INPUT",
        message:
          "بيانات السوق أو السهم أو العقد أو التفعيل غير مكتملة.",
      },
    };
  }

  const baseReport = runManual(manualInput);
  const report = await applySocial(baseReport);

  return {
    status: 200,
    body: {
      success: true,
      mode: "MANUAL",
      generatedAt: now().toISOString(),
      report,
    },
  };
}