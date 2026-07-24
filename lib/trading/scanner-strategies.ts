import type { TradierOpportunity } from "./tradier-scanner";

export type ScannerStrategyName = "FAHD" | "GOLDEN";

export type MarketBias = "CALL_BIAS" | "PUT_BIAS" | "WAIT";

export type Direction = "CALL" | "PUT";

export type ExecutionStatus = "WAIT_TRIGGER" | "READY" | "REJECTED";

export type StrategyOpportunity = Omit<TradierOpportunity, "rank"> & {
  marketBias: MarketBias;
  marketScore: number;
  finalScore: number;
  executionStatus: ExecutionStatus;
};

export type RankedStrategyOpportunity = StrategyOpportunity & {
  rank: number;
};

export interface ScannerStrategy {
  name: ScannerStrategyName;

  timeframe: "15min" | "1h" | "1day";

  minimumFinalScore: number;

  scoreWeight: number;

  maxResults: number;

  contractDefaults: {
    minPrice: number;
    maxPrice: number;
    minDelta: number;
    maxDelta: number;
    minVolume: number;
    minOpenInterest: number;
    maxSpreadPercent: number;
  };

  compareOpportunities: (
    first: StrategyOpportunity,
    second: StrategyOpportunity,
  ) => number;

  messages: {
    wait: string;
    found: (count: number) => string;
    notFound: string;
  };
}

export const FAHD_STRATEGY: ScannerStrategy = {
  name: "FAHD",
  timeframe: "15min",
  minimumFinalScore: 78,
  scoreWeight: 0.6,
  maxResults: 2,

  contractDefaults: {
    minPrice: 0.3,
    maxPrice: 15,
    minDelta: 0.45,
    maxDelta: 0.7,
    minVolume: 100,
    minOpenInterest: 500,
    maxSpreadPercent: 12,
  },

  compareOpportunities: (first, second) =>
    second.finalScore - first.finalScore ||
    second.score - first.score ||
    second.volume - first.volume ||
    second.openInterest - first.openInterest,

  messages: {
    wait: "السوق غير واضح؛ لا توجد صفقة ذهبية الآن.",

    found: (count) => `وجد فهد ${count} فرصة متوافقة مع اتجاه السوق.`,

    notFound: "لا يوجد عقد يحقق شروط السوق والعقد معًا.",
  },
};

export const GOLDEN_STRATEGY: ScannerStrategy = {
  name: "GOLDEN",
  timeframe: "15min",
  minimumFinalScore: 80,
  scoreWeight: 0.65,
  maxResults: 5,

  contractDefaults: {
    minPrice: 0.3,
    maxPrice: 15,
    minDelta: 0.35,
    maxDelta: 0.8,
    minVolume: 25,
    minOpenInterest: 100,
    maxSpreadPercent: 20,
  },

  compareOpportunities: (first, second) =>
    second.finalScore - first.finalScore || second.volume - first.volume,

  messages: {
    wait: "السوق بلا انحياز مؤكد؛ فهد يرفض إعطاء عقد ذهبي حتى يتأكد الاتجاه.",

    found: (count) =>
      `وجد فهد ${count} عقود متوافقة مع اتجاه السوق. الدخول مشروط بتأكيد الشمعة.`,

    notFound: "لا يوجد عقد يجمع جودة العقد مع اتجاه السوق حاليًا.",
  },
};

export function normalizeScoreWeight(scoreWeight: number): number {
  if (!Number.isFinite(scoreWeight)) {
    return 0.6;
  }

  return Math.max(0, Math.min(1, scoreWeight));
}

export function resolveResultLimit(
  strategy: ScannerStrategy,
  requestedResults?: number,
): number {
  const requested =
    typeof requestedResults === "number" && Number.isFinite(requestedResults)
      ? Math.floor(requestedResults)
      : strategy.maxResults;

  return Math.max(1, Math.min(strategy.maxResults, requested));
}
