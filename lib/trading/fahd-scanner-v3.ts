import { getMarketDecision } from "@/lib/market-decision-engine";
import {
  scanTradierOpportunities,
  type TradierOpportunity,
  type TradierScannerConfig,
} from "./tradier-scanner";

type MarketBias = "CALL_BIAS" | "PUT_BIAS" | "WAIT";
type Direction = "CALL" | "PUT";

export interface FahdScannerV3Config extends TradierScannerConfig {
  timeframe?: "15min" | "1h" | "1day";
  minimumFinalScore?: number;
  maxResults?: number;
}

export interface FahdScannerV3Opportunity extends TradierOpportunity {
  marketBias: MarketBias;
  marketScore: number;
  finalScore: number;
  triggerStatus: "WAIT_TRIGGER";
}

function directionFromBias(bias: MarketBias): Direction | null {
  if (bias === "CALL_BIAS") return "CALL";
  if (bias === "PUT_BIAS") return "PUT";
  return null;
}

export async function runFahdScannerV3(config: FahdScannerV3Config) {
  const timeframe = config.timeframe ?? "15min";
  const maxResults = Math.max(1, Math.min(2, config.maxResults ?? 2));
  const minimumFinalScore = config.minimumFinalScore ?? 78;

  const market = await getMarketDecision(timeframe);
  const bias = market.bias as MarketBias;
  const allowedDirection = directionFromBias(bias);

  if (!allowedDirection) {
    return {
      generatedAt: new Date().toISOString(),
      status: "WAIT",
      market,
      opportunities: [],
      message: "السوق غير واضح؛ لا توجد صفقة ذهبية الآن.",
    };
  }

  const contracts = await scanTradierOpportunities({
    ...config,
    results: 20,
    minDelta: config.minDelta ?? 0.45,
    maxDelta: config.maxDelta ?? 0.70,
    minVolume: config.minVolume ?? 100,
    minOpenInterest: config.minOpenInterest ?? 500,
    maxSpreadPercent: config.maxSpreadPercent ?? 12,
  });

  const directionalMarketScore =
    allowedDirection === "CALL"
      ? market.probabilities.bullish
      : market.probabilities.bearish;

  const opportunities: FahdScannerV3Opportunity[] = contracts.opportunities
    .filter((item) => item.direction === allowedDirection)
    .map((item) => ({
      ...item,
      marketBias: bias,
      marketScore: directionalMarketScore,
      finalScore: Math.round(item.score * 0.6 + directionalMarketScore * 0.4),
      triggerStatus: "WAIT_TRIGGER" as const,
    }))
    .filter((item) => item.finalScore >= minimumFinalScore)
    .sort((a, b) =>
      b.finalScore - a.finalScore ||
      b.score - a.score ||
      b.volume - a.volume ||
      b.openInterest - a.openInterest
    )
    .slice(0, maxResults)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    generatedAt: new Date().toISOString(),
    status: opportunities.length ? "OPPORTUNITIES_FOUND" : "NO_MATCH",
    market,
    contractsScanned: contracts.contractsScanned,
    qualifiedContracts: contracts.qualifiedContracts,
    opportunities,
    message: opportunities.length
      ? `وجد فهد ${opportunities.length} فرصة متوافقة مع اتجاه السوق.`
      : "لا يوجد عقد يحقق شروط السوق والعقد معًا.",
  };
}
