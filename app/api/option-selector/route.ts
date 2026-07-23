import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  scanTradierOpportunities,
  type TradierOpportunity,
} from "@/lib/trading/tradier-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type OptionDirection =
  | "CALL"
  | "PUT";

type SelectorRequest = {
  symbol?: unknown;
  direction?: unknown;
  maxRiskUsd?: unknown;
  maxDte?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
};

function normalizeSymbol(
  value: unknown
): string {
  if (typeof value !== "string") {
    throw new Error(
      "SYMBOL_REQUIRED"
    );
  }

  const symbol =
    value
      .trim()
      .toUpperCase();

  if (
    !/^[A-Z][A-Z0-9.]{0,9}$/.test(
      symbol
    )
  ) {
    throw new Error(
      "INVALID_SYMBOL"
    );
  }

  return symbol;
}

function normalizeDirection(
  value: unknown
): OptionDirection {
  const direction =
    typeof value === "string"
      ? value
          .trim()
          .toUpperCase()
      : "";

  if (
    direction !== "CALL" &&
    direction !== "PUT"
  ) {
    throw new Error(
      "DIRECTION_REQUIRED"
    );
  }

  return direction;
}

function numberBetween(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed)
  ) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(
      maximum,
      parsed
    )
  );
}

function buildRiskPlan(
  contract: TradierOpportunity,
  maxRiskUsd: number
) {
  const entry =
    contract.midpoint;

  const stop =
    Number(
      Math.max(
        0.01,
        entry * 0.7
      ).toFixed(2)
    );

  const target1 =
    Number(
      (
        entry * 1.4
      ).toFixed(2)
    );

  const target2 =
    Number(
      (
        entry * 1.8
      ).toFixed(2)
    );

  const riskPerContract =
    Number(
      (
        (
          entry - stop
        ) * 100
      ).toFixed(2)
    );

  const estimatedCostPerContract =
    Number(
      (
        entry * 100
      ).toFixed(2)
    );

  const contracts =
    riskPerContract > 0
      ? Math.max(
          0,
          Math.floor(
            maxRiskUsd /
            riskPerContract
          )
        )
      : 0;

  return {
    entry,
    stop,
    target1,
    target2,
    riskPerContract,
    estimatedCostPerContract,
    maxRiskUsd,
    suggestedContracts:
      contracts,
    executable:
      contracts >= 1 &&
      contract.score >= 72,
  };
}

function buildDecision(
  contract: TradierOpportunity
) {
  if (
    contract.score >= 85
  ) {
    return {
      action: "BUY",
      label:
        "شراء العقد",
      confidence:
        contract.score,
    };
  }

  if (
    contract.score >= 72
  ) {
    return {
      action: "WATCH",
      label:
        "مراقبة العقد وانتظار تأكيد الدخول",
      confidence:
        contract.score,
    };
  }

  return {
    action: "REJECT",
    label:
      "رفض العقد",
    confidence:
      contract.score,
  };
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (
        await request.json()
      ) as SelectorRequest;

    const symbol =
      normalizeSymbol(
        body.symbol
      );

    const direction =
      normalizeDirection(
        body.direction
      );

    const maxRiskUsd =
      numberBetween(
        body.maxRiskUsd,
        100,
        25,
        10_000
      );

    const maxDte =
      numberBetween(
        body.maxDte,
        7,
        0,
        30
      );

    const minPrice =
      numberBetween(
        body.minPrice,
        0.3,
        0.01,
        100
      );

    const maxPrice =
      numberBetween(
        body.maxPrice,
        15,
        minPrice,
        500
      );

    const scan =
      await scanTradierOpportunities({
        symbols: [
          symbol,
        ],
        maxDte,
        expirationsPerSymbol:
          4,
        results:
          20,
        minPrice,
        maxPrice,
        minVolume:
          25,
        minOpenInterest:
          100,
        maxSpreadPercent:
          20,
        minDelta:
          0.35,
        maxDelta:
          0.8,
      });

    const candidates =
      scan.opportunities.filter(
        (item) =>
          item.underlying ===
            symbol &&
          item.direction ===
            direction
      );

    const selected =
      candidates[0] ??
      null;

    if (!selected) {
      return NextResponse.json({
        success: true,
        selected: null,
        symbol,
        direction,
        message:
          "لا يوجد عقد يحقق شروط السيولة والسبريد والدلتا حاليًا.",
        scanSummary: {
          contractsScanned:
            scan.contractsScanned,
          qualifiedContracts:
            scan.qualifiedContracts,
          ivHistoryEnriched:
            scan.ivHistoryEnriched,
        },
      });
    }

    const riskPlan =
      buildRiskPlan(
        selected,
        maxRiskUsd
      );

    const decision =
      buildDecision(
        selected
      );

    return NextResponse.json({
      success: true,
      selected: {
        ...selected,
        decision,
        riskPlan,
      },
      alternatives:
        candidates
          .slice(
            1,
            4
          )
          .map(
            (item) => ({
              contractSymbol:
                item.contractSymbol,
              strike:
                item.strike,
              expiration:
                item.expiration,
              daysToExpiration:
                item.daysToExpiration,
              midpoint:
                item.midpoint,
              delta:
                item.delta,
              gamma:
                item.gamma,
              theta:
                item.theta,
              vega:
                item.vega,
              impliedVolatility:
                item.impliedVolatility,
              spreadPercent:
                item.spreadPercent,
              volume:
                item.volume,
              openInterest:
                item.openInterest,
              score:
                item.score,
              tier:
                item.tier,
              ivContext:
                item.ivContext,
            })
          ),
      scanSummary: {
        contractsScanned:
          scan.contractsScanned,
        qualifiedContracts:
          scan.qualifiedContracts,
        ivHistoryEnriched:
          scan.ivHistoryEnriched,
      },
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

    const status =
      message ===
        "SYMBOL_REQUIRED" ||
      message ===
        "INVALID_SYMBOL" ||
      message ===
        "DIRECTION_REQUIRED"
        ? 400
        : message.includes(
              "TRADIER_ACCESS_TOKEN"
            )
          ? 503
          : 500;

    return NextResponse.json(
      {
        success: false,
        error:
          message,
      },
      {
        status,
      }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service:
      "Fahd Option Selector V2",
    method:
      "POST",
    engine:
      "Option Brain V2 + IV History",
    example: {
      symbol:
        "SPY",
      direction:
        "PUT",
      maxRiskUsd:
        100,
      maxDte:
        7,
      minPrice:
        0.3,
      maxPrice:
        15,
    },
  });
}
