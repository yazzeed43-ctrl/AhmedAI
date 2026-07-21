import { NextResponse } from "next/server";

import {
  runTradeEngine,
  type TradeEngineInput,
} from "@/lib/trading/trade-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateInput(input: unknown): input is TradeEngineInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const data = input as Partial<TradeEngineInput>;

  if (!data.market || !data.stock || !data.option || !data.trigger) {
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

  if (!isValidNumber(data.trigger.candleClose)) {
    return false;
  }

  return true;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();

    if (!validateInput(body)) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_INPUT",
          message:
            "بيانات السوق أو السهم أو العقد أو التفعيل غير مكتملة.",
        },
        {
          status: 400,
        },
      );
    }

    const report = runTradeEngine(body);

    return NextResponse.json(
      {
        success: true,
        generatedAt: new Date().toISOString(),
        report,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("Analyze trade API error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "INTERNAL_SERVER_ERROR",
        message: "حدث خطأ أثناء تشغيل محرك تحليل الصفقة.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd Trade Engine",
    endpoint: "/api/analyze-trade",
    method: "POST",
    status: "READY",
  });
}
