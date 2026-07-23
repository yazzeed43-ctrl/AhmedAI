import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  evaluateExit,
  type ExitBrainInput,
} from "@/lib/fahd/exit-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TradeExitRequest = {
  entryPrice?: unknown;
  currentPrice?: unknown;
  stopPrice?: unknown;
  target1?: unknown;
  target2?: unknown;

  contracts?: unknown;
  remainingContracts?: unknown;

  highestPriceSinceEntry?: unknown;

  optionScore?: unknown;
  directionalStockScore?: unknown;
  marketScore?: unknown;

  theta?: unknown;
  daysToExpiration?: unknown;

  triggerStillValid?: unknown;
  marketDataFresh?: unknown;
  highImpactNews?: unknown;
};

function requiredNumber(
  value: unknown,
  field: string
): number {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed)
  ) {
    throw new Error(
      `${field} is required`
    );
  }

  return parsed;
}

function optionalNumber(
  value: unknown
): number | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function optionalBoolean(
  value: unknown
): boolean | undefined {
  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  return undefined;
}

function positiveInteger(
  value: unknown,
  field: string
): number {
  const parsed =
    Math.floor(
      requiredNumber(
        value,
        field
      )
    );

  if (parsed < 0) {
    throw new Error(
      `${field} must be zero or greater`
    );
  }

  return parsed;
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (
        await request.json()
      ) as TradeExitRequest;

    const input:
      ExitBrainInput = {
      entryPrice:
        requiredNumber(
          body.entryPrice,
          "entryPrice"
        ),

      currentPrice:
        requiredNumber(
          body.currentPrice,
          "currentPrice"
        ),

      stopPrice:
        requiredNumber(
          body.stopPrice,
          "stopPrice"
        ),

      target1:
        requiredNumber(
          body.target1,
          "target1"
        ),

      target2:
        requiredNumber(
          body.target2,
          "target2"
        ),

      contracts:
        positiveInteger(
          body.contracts,
          "contracts"
        ),

      remainingContracts:
        positiveInteger(
          body.remainingContracts,
          "remainingContracts"
        ),

      highestPriceSinceEntry:
        optionalNumber(
          body.highestPriceSinceEntry
        ),

      optionScore:
        optionalNumber(
          body.optionScore
        ),

      directionalStockScore:
        optionalNumber(
          body.directionalStockScore
        ),

      marketScore:
        optionalNumber(
          body.marketScore
        ),

      theta:
        optionalNumber(
          body.theta
        ) ?? null,

      daysToExpiration:
        optionalNumber(
          body.daysToExpiration
        ),

      triggerStillValid:
        optionalBoolean(
          body.triggerStillValid
        ),

      marketDataFresh:
        optionalBoolean(
          body.marketDataFresh
        ),

      highImpactNews:
        optionalBoolean(
          body.highImpactNews
        ),
    };

    const result =
      evaluateExit(input);

    return NextResponse.json({
      success: true,
      engine:
        "Fahd Exit Brain V1",
      result,
      generatedAt:
        new Date()
          .toISOString(),
    });
  } catch (
    error: unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return NextResponse.json(
      {
        success: false,
        error:
          "TRADE_EXIT_EVALUATION_FAILED",
        message,
      },
      {
        status: 400,
      }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service:
      "Fahd Trade Exit API",
    method:
      "POST",
    example: {
      entryPrice:
        2.8,
      currentPrice:
        3.7,
      stopPrice:
        1.96,
      target1:
        3.78,
      target2:
        4.76,
      contracts:
        1,
      remainingContracts:
        1,
      highestPriceSinceEntry:
        3.7,
      optionScore:
        84,
      directionalStockScore:
        59,
      marketScore:
        71,
      theta:
        -1.47,
      daysToExpiration:
        1,
      triggerStillValid:
        true,
      marketDataFresh:
        true,
      highImpactNews:
        false,
    },
  });
}
