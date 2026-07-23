import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  runFahdScannerV3,
} from "@/lib/trading/fahd-scanner-v3";

import {
  getTechnicalIndicators,
} from "@/lib/market-indicators";

import {
  scoreStock,
} from "@/lib/fahd/stock-brain";

import {
  approveTrade,
} from "@/lib/fahd/guardian";

import {
  makeTradeDecision,
} from "@/lib/fahd/decision-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SYMBOLS = [
  "SPX",
  "SPY",
  "QQQ",
  "AAPL",
  "NVDA",
  "TSLA",
  "AMZN",
  "META",
  "AMD",
  "MSFT",
];

type RequestBody = {
  symbols?: unknown;
  maxRiskUsd?: unknown;
  maxResults?: unknown;
  timeframe?: unknown;
  maxDte?: unknown;
};

type SupportedTimeframe =
  | "15min"
  | "1h"
  | "1day";

function normalizeSymbols(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SYMBOLS;
  }

  const symbols = value
    .filter(
      (item): item is string =>
        typeof item === "string"
    )
    .map((item) =>
      item.trim().toUpperCase()
    )
    .filter((item) =>
      /^[A-Z][A-Z0-9.]{0,9}$/.test(item)
    );

  return symbols.length > 0
    ? [...new Set(symbols)].slice(0, 20)
    : DEFAULT_SYMBOLS;
}

function numberBetween(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(maximum, parsed)
  );
}

function normalizeTimeframe(
  value: unknown
): SupportedTimeframe {
  return value === "1h" ||
    value === "1day"
    ? value
    : "15min";
}

function buildRiskPlan(
  midpoint: number,
  score: number,
  maxRiskUsd: number
) {
  const entry = midpoint;

  const stopPercent =
    score >= 90
      ? 0.25
      : 0.3;

  const stop = Number(
    Math.max(
      0.01,
      entry * (1 - stopPercent)
    ).toFixed(2)
  );

  const target1 = Number(
    (entry * 1.35).toFixed(2)
  );

  const target2 = Number(
    (entry * 1.7).toFixed(2)
  );

  const riskPerContract = Number(
    ((entry - stop) * 100).toFixed(2)
  );

  const costPerContract = Number(
    (entry * 100).toFixed(2)
  );

  const suggestedContracts =
    riskPerContract > 0
      ? Math.floor(
          maxRiskUsd /
          riskPerContract
        )
      : 0;

  return {
    entry,
    stop,
    target1,
    target2,
    riskPerContract,
    costPerContract,
    maxRiskUsd,
    suggestedContracts:
      Math.max(
        0,
        suggestedContracts
      ),
  };
}

function isTechnicalError(
  value: Awaited<
    ReturnType<
      typeof getTechnicalIndicators
    >
  >
): value is {
  error: string;
} {
  return "error" in value;
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as RequestBody;

    const symbols =
      normalizeSymbols(body.symbols);

    const timeframe =
      normalizeTimeframe(
        body.timeframe
      );

    const maxRiskUsd =
      numberBetween(
        body.maxRiskUsd,
        100,
        25,
        10_000
      );

    const maxResults =
      Math.floor(
        numberBetween(
          body.maxResults,
          2,
          1,
          2
        )
      );

    const maxDte =
      Math.floor(
        numberBetween(
          body.maxDte,
          7,
          1,
          14
        )
      );

    const result =
      await runFahdScannerV3({
        symbols,
        timeframe,
        maxDte,
        expirationsPerSymbol: 3,
        maxResults,
        minPrice: 0.3,
        maxPrice: 15,
        minVolume: 100,
        minOpenInterest: 500,
        maxSpreadPercent: 12,
        minDelta: 0.45,
        maxDelta: 0.7,
        minimumFinalScore: 80,
      });

    if (
      result.status === "WAIT" ||
      result.opportunities.length === 0
    ) {
      return NextResponse.json({
        success: true,
        action: "WAIT",
        market: result.market,
        recommendations: [],
        rejected: [],
        message: result.message,
        generatedAt:
          new Date().toISOString(),
      });
    }

    const evaluated =
      await Promise.all(
        result.opportunities.map(
          async (item) => {
            const technical =
              await getTechnicalIndicators(
                item.underlying,
                timeframe
              );

            if (
              isTechnicalError(
                technical
              )
            ) {
              return {
                action:
                  "REJECT" as const,
                approved: false,
                blockingReasons: [
                  `Stock indicators unavailable: ${technical.error}`,
                ],
                recommendation: null,
              };
            }

            const metrics =
              technical.stockMetrics;

            const stock =
              scoreStock(
                {
                  price:
                    item.underlyingPrice,
                  changePercent:
                    item.underlyingChangePercent ??
                    0,
                  marketChangePercent:
                    null,
                  ema9:
                    metrics.ema9,
                  ema20:
                    metrics.ema20,
                  ema50:
                    metrics.ema50,
                  vwap:
                    metrics.vwap,
                  atr14:
                    metrics.atr14,
                  volume:
                    metrics.volume,
                  averageVolume20:
                    metrics.averageVolume20,
                  relativeVolume:
                    metrics.relativeVolume,
                  previousHigh:
                    metrics.previousHigh,
                  previousLow:
                    metrics.previousLow,
                  currentHigh:
                    metrics.currentHigh,
                  currentLow:
                    metrics.currentLow,
                },
                item.direction
              );

            const riskPlan =
              buildRiskPlan(
                item.midpoint,
                item.finalScore,
                maxRiskUsd
              );

const guardian = approveTrade({
  marketScore: item.marketScore,
  directionalStockScore: stock.directionalScore,
  optionScore: item.finalScore,

  spreadPercent: item.spreadPercent,
  openInterest: item.openInterest,
  volume: item.volume,

  ivRank: item.ivContext?.ivRank ?? 50,

  highImpactNews: false,
});
            const decision =
              makeTradeDecision({
                marketScore:
                  item.marketScore,
                directionalStockScore:
                  stock.directionalScore,
                optionScore:
                  item.finalScore,
                guardianApproved:
                  guardian.approved,
                suggestedContracts:
                  riskPlan.suggestedContracts,
                ivRank:
                  item.ivContext.ivRank,
                ivPercentile:
                  item.ivContext.ivPercentile,
                ivSamples:
                  item.ivContext.samples,
                highImpactNews:
                  false,
                marketDataFresh:
                  result.market.primary
                    ?.dataStatus
                    ?.freshness === "fresh",
                triggerConfirmed:
                  result.market
                    .triggerRequired === false,
              });

            const recommendation = {
              rank:
                item.rank,
              action:
                decision.action,
              approved:
                decision.approved,
              confidence:
                decision.confidence,
              decisionReasons:
                decision.reasons,
              blockingReasons:
                decision.blockingReasons,
              decisionComponents:
                decision.components,
              underlying:
                item.underlying,
              direction:
                item.direction,
              contractSymbol:
                item.contractSymbol,
              expiration:
                item.expiration,
              daysToExpiration:
                item.daysToExpiration,
              strike:
                item.strike,
              underlyingPrice:
                item.underlyingPrice,
              underlyingChangePercent:
                item.underlyingChangePercent ??
                0,
              bid:
                item.bid,
              ask:
                item.ask,
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
              volume:
                item.volume,
              openInterest:
                item.openInterest,
              spreadPercent:
                item.spreadPercent,
              contractScore:
                item.score,
              optionBrain:
                item.optionBrain,
              ivContext:
                item.ivContext,
              marketScore:
                item.marketScore,
              stockScore:
                stock.score,
              directionalStockScore:
                stock.directionalScore,
              stockTrend:
                stock.trend,
              stockReasons:
                stock.reasons,
              stockWarnings:
                stock.warnings,
              stockComponents:
                stock.components,
              finalScore:
                item.finalScore,
              guardian: {
                approved:
                  guardian.approved,
                reasons:
                  guardian.reasons,
              },
              reasons:
                item.reasons,
              warnings:
                item.warnings,
              riskPlan,
              trigger:
                decision.action === "BUY"
                  ? "انتظر تأكيد الاختراق أو الكسر قبل التنفيذ"
                  : decision.action === "WATCH"
                    ? "راقب العقد وانتظر تحسن التأكيد قبل الدخول"
                    : "لا تدخل؛ الصفقة لم تجتز قرار فهد النهائي",
            };

            return {
              action:
                decision.action,
              approved:
                decision.approved,
              blockingReasons:
                decision.blockingReasons,
              recommendation,
            };
          }
        )
      );

    const recommendations =
      evaluated
        .filter(
          (item) =>
            item.recommendation !==
              null &&
            (
              item.action === "BUY" ||
              item.action === "WATCH"
            )
        )
        .map(
          (item) =>
            item.recommendation
        );

    const rejected =
      evaluated
        .filter(
          (item) =>
            item.recommendation ===
              null ||
            (
              item.action !== "BUY" &&
              item.action !== "WATCH"
            )
        )
        .map(
          (item) => ({
            action:
              item.action,
            blockingReasons:
              item.blockingReasons,
            recommendation:
              item.recommendation,
          })
        );

    const hasBuy =
      recommendations.some(
        (item) =>
          item?.action === "BUY"
      );

    const hasWatch =
      recommendations.some(
        (item) =>
          item?.action === "WATCH"
      );

    const action =
      hasBuy
        ? "OPPORTUNITIES_FOUND"
        : hasWatch
          ? "WATCH"
          : "WAIT";

    return NextResponse.json({
      success: true,
      action,
      market:
        result.market,
      recommendations,
      rejected,
      scanSummary: {
        symbolsScanned:
          symbols,
        contractsScanned:
          result.contractsScanned,
        qualifiedContracts:
          result.qualifiedContracts,
      },
      message:
        hasBuy
          ? "وجد فهد فرص أوبشن اجتازت قرار السوق والسهم والعقد والمخاطر."
          : hasWatch
            ? "وجد فهد عقودًا تستحق المراقبة، لكن الدخول يحتاج تأكيدًا إضافيًا."
            : "لا توجد صفقة أوبشن اجتازت قرار فهد النهائي.",
      generatedAt:
        new Date().toISOString(),
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
          "FAHD_RECOMMENDATIONS_FAILED",
        message,
      },
      {
        status: 500,
      }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service:
      "Fahd Options Recommendations V3",
    method:
      "POST",
    pipeline: [
      "Market Brain",
      "Stock Brain",
      "Option Brain V2",
      "IV History",
      "Guardian",
      "Decision Brain",
      "Risk Plan",
    ],
    defaults: {
      symbols:
        DEFAULT_SYMBOLS,
      timeframe:
        "15min",
      maxRiskUsd:
        100,
      maxResults:
        2,
      maxDte:
        7,
    },
  });
}