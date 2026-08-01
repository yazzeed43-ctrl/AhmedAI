import type {
  ComponentResult,
  ExplosionComponents,
  MarketDataFreshness,
} from "./types";

export interface ExplosionIndicatorFrame {
  lastPrice: number;
  dataStatus: { freshness: string };
  rsi: { value: number };
  macd: { histogram: number; previousHistogram: number };
  bollingerBands: { upper: number; mid: number; lower: number };
  stockMetrics: {
    ema9: number;
    ema20: number;
    ema50: number;
    vwap: number | null;
    atr14: number;
    relativeVolume: number | null;
    structure: "HIGHER_HIGH_HIGHER_LOW" | "LOWER_HIGH_LOWER_LOW" | "MIXED";
  };
  supportResistance: {
    support: number;
    resistance: number;
    val?: number;
    vah?: number;
    poc?: number;
  };
}

export interface ExplosionMarketInput {
  spxFiveMinute: ExplosionIndicatorFrame;
  spxFifteenMinute: ExplosionIndicatorFrame;
  spyFiveMinute: ExplosionIndicatorFrame;
}

const MAXIMUMS = {
  trend: 15,
  momentum: 20,
  volatility: 20,
  volume: 15,
  location: 10,
  structureLiquidity: 20,
} as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function component(
  name: keyof typeof MAXIMUMS,
  bull: number,
  bear: number,
  available: number,
  missingMetrics: string[],
  requiredMissing = false,
  reasons: string[] = [],
): ComponentResult {
  return {
    bullEarned: Math.max(0, Math.min(available, bull)),
    bearEarned: Math.max(0, Math.min(available, bear)),
    maximumWeight: MAXIMUMS[name],
    availableMetricWeight: available,
    configuredMetricWeight: 100,
    status: requiredMissing
      ? "REQUIRED_MISSING"
      : missingMetrics.length > 0
        ? "OPTIONAL_MISSING"
        : "AVAILABLE",
    reasons,
    missingMetrics,
  };
}

function trend(input: ExplosionMarketInput): ComponentResult {
  const frames = [input.spxFiveMinute, input.spxFifteenMinute];
  if (frames.some((f) => !finite(f.stockMetrics.ema9) || !finite(f.stockMetrics.ema20) || !finite(f.stockMetrics.ema50))) {
    return component("trend", 0, 0, 0, ["EMA_5M_15M"], true);
  }
  let bull = 0;
  let bear = 0;
  for (const frame of frames) {
    const { ema9, ema20, ema50 } = frame.stockMetrics;
    if (ema9 > ema20) bull += 25; else if (ema9 < ema20) bear += 25;
    if (ema20 > ema50) bull += 25; else if (ema20 < ema50) bear += 25;
  }
  return component("trend", bull, bear, 100, [], false, ["اتجاه EMA على 5 و15 دقيقة"]);
}

function momentum(input: ExplosionMarketInput): ComponentResult {
  const frame = input.spxFiveMinute;
  if (!finite(frame.rsi.value) || !finite(frame.macd.histogram) || !finite(frame.macd.previousHistogram)) {
    return component("momentum", 0, 0, 0, ["RSI_OR_MACD"], true);
  }
  let bull = 0;
  let bear = 0;
  if (frame.rsi.value >= 52) bull += 35;
  if (frame.rsi.value <= 48) bear += 35;
  if (frame.macd.histogram > 0) bull += 25;
  if (frame.macd.histogram < 0) bear += 25;
  const acceleration = frame.macd.histogram - frame.macd.previousHistogram;
  if (acceleration > 0) bull += 25;
  if (acceleration < 0) bear += 25;
  return component("momentum", bull, bear, 85, ["ADX", "ROC"], false, ["RSI وMACD وتسارع Histogram"]);
}

function volatility(input: ExplosionMarketInput): ComponentResult {
  const frame = input.spxFiveMinute;
  const bb = frame.bollingerBands;
  const atr = frame.stockMetrics.atr14;
  if (![bb.upper, bb.mid, bb.lower, atr, frame.lastPrice].every(finite) || bb.mid <= 0 || atr <= 0) {
    return component("volatility", 0, 0, 0, ["BOLLINGER_OR_ATR"], true);
  }
  const upperBreak = frame.lastPrice > bb.upper;
  const lowerBreak = frame.lastPrice < bb.lower;
  const expansionRatio = (bb.upper - bb.lower) / bb.mid;
  const atrRatio = atr / frame.lastPrice;
  let bull = upperBreak ? 45 : frame.lastPrice > bb.mid ? 25 : 0;
  let bear = lowerBreak ? 45 : frame.lastPrice < bb.mid ? 25 : 0;
  if (expansionRatio >= 0.004) { bull += 20; bear += 20; }
  if (atrRatio >= 0.0015) { bull += 20; bear += 20; }
  return component("volatility", bull, bear, 85, ["COMPRESSION_HISTORY"], false, ["موضع Bollinger وATR الحالي؛ تاريخ الانضغاط غير متاح"]);
}

function volume(input: ExplosionMarketInput): ComponentResult {
  const rvol = input.spyFiveMinute.stockMetrics.relativeVolume;
  if (!finite(rvol)) return component("volume", 0, 0, 0, ["SPY_RVOL"], true);
  const score = rvol >= 1.5 ? 90 : rvol >= 1.3 ? 75 : rvol >= 1 ? 55 : 25;
  return component("volume", score, score, 90, ["VOLUME_DELTA"], false, [`SPY RVOL ${rvol.toFixed(2)}`]);
}

function location(input: ExplosionMarketInput): ComponentResult {
  const frame = input.spxFiveMinute;
  const vwap = frame.stockMetrics.vwap;
  if (!finite(vwap) || !finite(frame.lastPrice)) return component("location", 0, 0, 0, ["VWAP"], true);
  let bull = frame.lastPrice > vwap ? 55 : 10;
  let bear = frame.lastPrice < vwap ? 55 : 10;
  const hasProfile = finite(frame.supportResistance.vah) && finite(frame.supportResistance.val);
  if (hasProfile) {
    if (frame.lastPrice > frame.supportResistance.vah!) bull += 30;
    if (frame.lastPrice < frame.supportResistance.val!) bear += 30;
  }
  return component("location", bull, bear, hasProfile ? 100 : 85, hasProfile ? [] : ["VOLUME_PROFILE"], false, ["موقع السعر من VWAP ومنطقة القيمة"]);
}

function structureLiquidity(input: ExplosionMarketInput): ComponentResult {
  const frame = input.spxFiveMinute;
  if (!finite(frame.supportResistance.support) || !finite(frame.supportResistance.resistance)) {
    return component("structureLiquidity", 0, 0, 0, ["SUPPORT_RESISTANCE"], true);
  }
  let bull = frame.stockMetrics.structure === "HIGHER_HIGH_HIGHER_LOW" ? 60 : 20;
  let bear = frame.stockMetrics.structure === "LOWER_HIGH_LOWER_LOW" ? 60 : 20;
  if (frame.lastPrice > frame.supportResistance.resistance) bull += 25;
  if (frame.lastPrice < frame.supportResistance.support) bear += 25;
  return component("structureLiquidity", bull, bear, 85, ["LIQUIDITY_SWEEP", "BOS_CHOCH"], false, ["هيكل السعر والدعم والمقاومة"]);
}

export function buildExplosionComponents(input: ExplosionMarketInput): ExplosionComponents {
  return {
    trend: trend(input),
    momentum: momentum(input),
    volatility: volatility(input),
    volume: volume(input),
    location: location(input),
    structureLiquidity: structureLiquidity(input),
  };
}

export function mapIndicatorFreshness(frames: ExplosionIndicatorFrame[]): MarketDataFreshness {
  const states = frames.map((frame) => frame.dataStatus.freshness);
  if (states.some((state) => state === "unknown")) return "MISSING";
  return states.every((state) => state === "recent") ? "FRESH" : "STALE";
}
