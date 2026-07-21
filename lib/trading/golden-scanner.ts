import { getMarketDecision } from "@/lib/market-decision-engine";
import {
  scanTradierOpportunities,
  type TradierOpportunity,
  type TradierScannerConfig,
} from "./tradier-scanner";

type Direction = "CALL" | "PUT";
type MarketBias = "CALL_BIAS" | "PUT_BIAS" | "WAIT";

export interface GoldenScannerConfig extends TradierScannerConfig {
  timeframe?: "15min" | "1h" | "1day";
  minimumFinalScore?: number;
}

export interface GoldenOpportunity extends TradierOpportunity {
  marketBias: MarketBias;
  marketScore: number;
  finalScore: number;
  status: "WAIT_TRIGGER";
}

export async function scanGoldenOpportunities(config: GoldenScannerConfig) {
  const timeframe = config.timeframe ?? "15min";
  const minimumFinalScore = config.minimumFinalScore ?? 80;

  const [market, contracts] = await Promise.all([
    getMarketDecision(timeframe),
    scanTradierOpportunities({
      ...config,
      results: Math.max(config.results ?? 5, 20),
    }),
  ]);

  const bias = market.bias as MarketBias;
  const allowedDirection: Direction | null =
    bias === "CALL_BIAS" ? "CALL" :
    bias === "PUT_BIAS" ? "PUT" :
    null;

  if (!allowedDirection) {
    return {
      generatedAt: new Date().toISOString(),
      status: "WAIT",
      market,
      contractsScanned: contracts.contractsScanned,
      qualifiedContracts: contracts.qualifiedContracts,
      opportunities: [],
      message: "السوق بلا انحياز مؤكد؛ فهد يرفض إعطاء عقد ذهبي حتى يتأكد الاتجاه.",
    };
  }

  const ranked: GoldenOpportunity[] = contracts.opportunities
    .filter((item) => item.direction === allowedDirection)
    .map((item) => {
      const marketScore =
        allowedDirection === "CALL"
          ? market.probabilities.bullish
          : market.probabilities.bearish;

      return {
        ...item,
        marketBias: bias,
        marketScore,
        finalScore: Math.round(item.score * 0.65 + marketScore * 0.35),
        status: "WAIT_TRIGGER" as const,
      };
    })
    .filter((item) => item.finalScore >= minimumFinalScore)
    .sort((a, b) => b.finalScore - a.finalScore || b.volume - a.volume)
    .slice(0, Math.min(5, Math.max(1, config.results ?? 3)))
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    generatedAt: new Date().toISOString(),
    status: ranked.length ? "OPPORTUNITIES_FOUND" : "NO_MATCH",
    market,
    contractsScanned: contracts.contractsScanned,
    qualifiedContracts: contracts.qualifiedContracts,
    opportunities: ranked,
    message: ranked.length
      ? `وجد فهد ${ranked.length} عقود متوافقة مع اتجاه السوق. الدخول مشروط بتأكيد الشمعة.`
      : "لا يوجد عقد يجمع جودة العقد مع اتجاه السوق حاليًا.",
  };
}
