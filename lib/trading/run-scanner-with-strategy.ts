import { getMarketDecision } from "@/lib/market-decision-engine";
import { scanTradierOpportunities } from "./tradier-scanner";
import {
  normalizeScoreWeight,
  resolveResultLimit,
  type ScannerStrategy,
  type StrategyOpportunity,
  type RankedStrategyOpportunity,
  type Direction,
  type MarketBias,
} from "./scanner-strategies";

export interface RunScannerConfig {
  symbols: string[];
  maxDte?: number;
  expirationsPerSymbol?: number;
  requestedResults?: number;
}

export interface RunScannerResult {
  generatedAt: string;
  status: "WAIT" | "OPPORTUNITIES_FOUND" | "NO_MATCH";
  market: Awaited<ReturnType<typeof getMarketDecision>>;
  contractsScanned: number;
  qualifiedContracts: number;
  opportunities: RankedStrategyOpportunity[];
  message: string;
}

// المحرك "غبي" عمدًا: ما يعرف شي عن فهد أو Golden، فقط ينفذ
// خطوات ثابتة حسب ما تمليه عليه الـ strategy الممررة له.
export async function runScannerWithStrategy(
  strategy: ScannerStrategy,
  config: RunScannerConfig,
): Promise<RunScannerResult> {
  const market = await getMarketDecision(strategy.timeframe);
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
      contractsScanned: 0,
      qualifiedContracts: 0,
      opportunities: [],
      message: strategy.messages.wait,
    };
  }

  const contracts = await scanTradierOpportunities({
    symbols: config.symbols,
    maxDte: config.maxDte,
    expirationsPerSymbol: config.expirationsPerSymbol,
    results: 20,
    minPrice: strategy.contractDefaults.minPrice,
    maxPrice: strategy.contractDefaults.maxPrice,
    minDelta: strategy.contractDefaults.minDelta,
    maxDelta: strategy.contractDefaults.maxDelta,
    minVolume: strategy.contractDefaults.minVolume,
    minOpenInterest: strategy.contractDefaults.minOpenInterest,
    maxSpreadPercent: strategy.contractDefaults.maxSpreadPercent,
  });

  const marketScore =
    allowedDirection === "CALL"
      ? market.probabilities.bullish
      : market.probabilities.bearish;

  const scoreWeight = normalizeScoreWeight(strategy.scoreWeight);
  const resultsLimit = resolveResultLimit(strategy, config.requestedResults);

  const opportunities: RankedStrategyOpportunity[] = contracts.opportunities
    .filter((item) => item.direction === allowedDirection)
    .map((item): StrategyOpportunity => {
      const { rank: _discardStaleRank, ...rest } = item;
      return {
        ...rest,
        marketBias: bias,
        marketScore,
        finalScore: Math.round(
          item.score * scoreWeight + marketScore * (1 - scoreWeight),
        ),
        // كل الفرص هنا لسا بانتظار تفعيل التريغر — ما فيه منطق
        // حاليًا ينتج READY أو REJECTED (راجع الملاحظة بالمحادثة).
        executionStatus: "WAIT_TRIGGER",
      };
    })
    .filter((item) => item.finalScore >= strategy.minimumFinalScore)
    .sort(strategy.compareOpportunities)
    .slice(0, resultsLimit)
    .map((item, index): RankedStrategyOpportunity => ({ ...item, rank: index + 1 }));

  return {
    generatedAt: new Date().toISOString(),
    status: opportunities.length ? "OPPORTUNITIES_FOUND" : "NO_MATCH",
    market,
    contractsScanned: contracts.contractsScanned,
    qualifiedContracts: contracts.qualifiedContracts,
    opportunities,
    message: opportunities.length
      ? strategy.messages.found(opportunities.length)
      : strategy.messages.notFound,
  };
}
