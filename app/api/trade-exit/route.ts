import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  evaluateExit,
  type ExitBrainInput,
} from "@/lib/fahd/exit-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenTradeRow = {
  id: string;
  contract_symbol: string;
  underlying: string;
  direction: "CALL" | "PUT";
  expiration: string;
  strike: number;

  entry_price: number;
  current_price: number;
  stop_price: number;
  target_1: number;
  target_2: number;

  contracts: number;
  remaining_contracts: number;
  highest_price_since_entry: number;

  market_score: number | null;
  directional_stock_score: number | null;
  option_score: number | null;

  theta: number | null;
  days_to_expiration: number | null;

  trigger_still_valid: boolean;
  market_data_fresh: boolean;
  high_impact_news: boolean;

  status:
    | "OPEN"
    | "PARTIAL"
    | "CLOSED";
};

type TradeExitRequest = {
  contractSymbol?: unknown;
  currentPrice?: unknown;

  optionScore?: unknown;
  directionalStockScore?: unknown;
  marketScore?: unknown;

  theta?: unknown;
  daysToExpiration?: unknown;

  triggerStillValid?: unknown;
  marketDataFresh?: unknown;
  highImpactNews?: unknown;

  applyDecision?: unknown;
};

function getSupabaseAdmin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing"
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing"
    );
  }

  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

function requiredString(
  value: unknown,
  field: string
): string {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(
      `${field} is required`
    );
  }

  return value
    .trim()
    .toUpperCase();
}

function requiredNumber(
  value: unknown,
  field: string
): number {
  const parsed =
    Number(value);

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

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function optionalBoolean(
  value: unknown
): boolean | undefined {
  return typeof value === "boolean"
    ? value
    : undefined;
}

function buildExitInput(
  trade: OpenTradeRow,
  body: TradeExitRequest,
  currentPrice: number
): ExitBrainInput {
  return {
    entryPrice:
      Number(trade.entry_price),

    currentPrice,

    stopPrice:
      Number(trade.stop_price),

    target1:
      Number(trade.target_1),

    target2:
      Number(trade.target_2),

    contracts:
      Number(trade.contracts),

    remainingContracts:
      Number(
        trade.remaining_contracts
      ),

    highestPriceSinceEntry:
      Math.max(
        Number(
          trade.highest_price_since_entry
        ),
        currentPrice
      ),

    optionScore:
      optionalNumber(
        body.optionScore
      ) ??
      trade.option_score ??
      undefined,

    directionalStockScore:
      optionalNumber(
        body.directionalStockScore
      ) ??
      trade.directional_stock_score ??
      undefined,

    marketScore:
      optionalNumber(
        body.marketScore
      ) ??
      trade.market_score ??
      undefined,

    theta:
      optionalNumber(
        body.theta
      ) ??
      trade.theta ??
      null,

    daysToExpiration:
      optionalNumber(
        body.daysToExpiration
      ) ??
      trade.days_to_expiration ??
      undefined,

    triggerStillValid:
      optionalBoolean(
        body.triggerStillValid
      ) ??
      trade.trigger_still_valid,

    marketDataFresh:
      optionalBoolean(
        body.marketDataFresh
      ) ??
      trade.market_data_fresh,

    highImpactNews:
      optionalBoolean(
        body.highImpactNews
      ) ??
      trade.high_impact_news,
  };
}

function nextStatus(
  currentStatus:
    | "OPEN"
    | "PARTIAL"
    | "CLOSED",
  action: string
):
  | "OPEN"
  | "PARTIAL"
  | "CLOSED" {
  if (
    action === "EXIT_FULL"
  ) {
    return "CLOSED";
  }

  if (
    action ===
      "TAKE_PARTIAL_PROFIT"
  ) {
    return "PARTIAL";
  }

  return currentStatus;
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (
        await request.json()
      ) as TradeExitRequest;

    const contractSymbol =
      requiredString(
        body.contractSymbol,
        "contractSymbol"
      );

    const currentPrice =
      requiredNumber(
        body.currentPrice,
        "currentPrice"
      );

    if (currentPrice <= 0) {
      throw new Error(
        "currentPrice must be greater than zero"
      );
    }

    const applyDecision =
      body.applyDecision === true;

    const supabase =
      getSupabaseAdmin();

    const {
      data,
      error,
    } =
      await supabase
        .from(
          "fahd_open_trades"
        )
        .select("*")
        .eq(
          "contract_symbol",
          contractSymbol
        )
        .in(
          "status",
          [
            "OPEN",
            "PARTIAL",
          ]
        )
        .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to load trade: ${error.message}`
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error:
            "OPEN_TRADE_NOT_FOUND",
          message:
            "No open trade was found for this contract symbol.",
        },
        {
          status: 404,
        }
      );
    }

    const trade =
      data as OpenTradeRow;

    const input =
      buildExitInput(
        trade,
        body,
        currentPrice
      );

    const result =
      evaluateExit(input);

    const status =
      applyDecision
        ? nextStatus(
            trade.status,
            result.action
          )
        : trade.status;

    const highestPrice =
      Math.max(
        Number(
          trade.highest_price_since_entry
        ),
        currentPrice
      );

    const remainingContracts =
      applyDecision &&
      result.action ===
        "EXIT_FULL"
        ? 0
        : applyDecision &&
            result.action ===
              "TAKE_PARTIAL_PROFIT"
          ? Math.max(
              0,
              Number(
                trade.remaining_contracts
              ) -
                result
                  .suggestedExitContracts
            )
          : Number(
              trade.remaining_contracts
            );

    const updatePayload = {
      current_price:
        currentPrice,

      highest_price_since_entry:
        highestPrice,

      market_score:
        input.marketScore ??
        null,

      directional_stock_score:
        input.directionalStockScore ??
        null,

      option_score:
        input.optionScore ??
        null,

      theta:
        input.theta ??
        null,

      days_to_expiration:
        input.daysToExpiration ??
        null,

      trigger_still_valid:
        input.triggerStillValid ??
        true,

      market_data_fresh:
        input.marketDataFresh ??
        true,

      high_impact_news:
        input.highImpactNews ??
        false,

      exit_action:
        result.action,

      next_stop:
        result.nextStop,

      suggested_exit_contracts:
        result.suggestedExitContracts,

      stop_price:
        applyDecision
          ? result.nextStop
          : Number(
              trade.stop_price
            ),

      remaining_contracts:
        remainingContracts,

      status,

      last_evaluated_at:
        new Date()
          .toISOString(),

      closed_at:
        status === "CLOSED"
          ? new Date()
              .toISOString()
          : null,
    };

    const {
      data: updatedTrade,
      error: updateError,
    } =
      await supabase
        .from(
          "fahd_open_trades"
        )
        .update(
          updatePayload
        )
        .eq(
          "id",
          trade.id
        )
        .select("*")
        .single();

    if (updateError) {
      throw new Error(
        `Failed to update trade: ${updateError.message}`
      );
    }

    return NextResponse.json({
      success: true,
      engine:
        "Fahd Exit Brain V2",
      applyDecision,
      result,
      trade:
        updatedTrade,
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
      "Fahd Trade Exit API V2",
    method:
      "POST",
    modes: {
      preview:
        "Use applyDecision=false to evaluate and save the recommendation without changing trade status or remaining contracts.",
      apply:
        "Use applyDecision=true to apply the stop, partial exit, or full exit to the database record.",
    },
    example: {
      contractSymbol:
        "SPY260724P00740000",
      currentPrice:
        3.7,
      marketScore:
        71,
      directionalStockScore:
        59,
      optionScore:
        84,
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
      applyDecision:
        false,
    },
  });
}