import type { OptionBrainResult } from "@/lib/fahd/option-brain";

export interface TradierScannerConfig {
  symbols: string[];
  maxDte?: number;
  expirationsPerSymbol?: number;
  results?: number;
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  minOpenInterest?: number;
  maxSpreadPercent?: number;
  minDelta?: number;
  maxDelta?: number;
}

export interface IVContext {
  ivRank: number | null;
  ivPercentile: number | null;
  samples: number;
  signal: "LOW" | "NORMAL" | "HIGH" | "INSUFFICIENT_DATA";
  scoreAdjustment: number;
}

export interface TradierOpportunity {
  rank: number;
  tier: "GOLD" | "STRONG" | "WATCH";
  underlying: string;
  underlyingPrice: number;
  underlyingChangePercent: number | null;
  direction: "CALL" | "PUT";
  contractSymbol: string;
  expiration: string;
  daysToExpiration: number;
  strike: number;
  bid: number;
  ask: number;
  midpoint: number;
  spreadPercent: number;
  last: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  volume: number;
  openInterest: number;
  proximityPercent: number;
  score: number;
  reasons: string[];
  warnings: string[];
  optionBrain: OptionBrainResult;
  ivContext: IVContext;
}

// نتيجة تسجيل عقد واحد قبل إضافة rank النهائي وسياق IV التاريخي
// (يُضافوا لاحقًا بمرحلتين منفصلتين: enrichWithIVHistory ثم الترتيب النهائي)
export type BaseOpportunity = Omit<TradierOpportunity, "rank" | "ivContext">;
