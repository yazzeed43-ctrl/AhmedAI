import type { RawMarketData } from "./signal-normalizer";
import { getTechnicalIndicators } from "@/lib/market-indicators";
import { getTradierQuote } from "@/lib/tradier";

// الخطوة (أ) من بناء analyze_trade التلقائي: تجمع بيانات السوق العامة
// (SPY وQQQ) اللي يحتاجها RawMarketData، بدل ما يبنيها النموذج يدويًا.
// VIX وbreadth وsector غير متوفرة حاليًا من مصدر عام موحّد بالمشروع؛
// تُترك فارغة (وهي حقول اختيارية أصلًا بـRawMarketData) بدل اختراعها.

export type MarketDataResult =
  | { status: "READY"; data: RawMarketData }
  | { status: "WAIT_DATA"; reason: string };

export interface MarketDataDeps {
  getIndicators: typeof getTechnicalIndicators;
  getQuote: typeof getTradierQuote;
}

const defaultMarketDataDeps: MarketDataDeps = {
  getIndicators: getTechnicalIndicators,
  getQuote: getTradierQuote,
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasError(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value);
}

type IndexLeg = RawMarketData["spy"];

async function fetchIndexLeg(
  symbol: "SPY" | "QQQ",
  timeframe: string,
  deps: MarketDataDeps
): Promise<
  | { ok: true; leg: IndexLeg }
  | { ok: false; reason: string }
> {
  const [indicators, quote] = await Promise.all([
    deps.getIndicators(symbol, timeframe),
    deps.getQuote(symbol),
  ]);

  const indicatorsFailed = hasError(indicators);
  const quoteFailed = hasError(quote);

  const price =
    (!quoteFailed ? num((quote as any)?.last) : null) ??
    (!quoteFailed ? num((quote as any)?.close) : null) ??
    (!indicatorsFailed ? num((indicators as any)?.lastPrice) : null);

  if (price === null) {
    return {
      ok: false,
      reason: `تعذّر جلب سعر ${symbol}${
        indicatorsFailed ? `: ${(indicators as any).error}` : ""
      }${quoteFailed ? `: ${(quote as any).error}` : ""}`,
    };
  }

  const metrics = !indicatorsFailed
    ? (indicators as any)?.stockMetrics
    : null;

  const rsi = !indicatorsFailed
    ? (num((indicators as any)?.rsi?.value) ??
      num((indicators as any)?.rsi))
    : null;

  return {
    ok: true,
    leg: {
      price,
      vwap: metrics ? num(metrics.vwap) : null,
      ema20: metrics ? num(metrics.ema20) : null,
      ema50: metrics ? num(metrics.ema50) : null,
      rsi,
      changePercent: !quoteFailed
        ? num((quote as any)?.change_percentage)
        : null,
    },
  };
}

export async function fetchMarketData(
  timeframe: string = "15min",
  deps: MarketDataDeps = defaultMarketDataDeps
): Promise<MarketDataResult> {
  const [spyResult, qqqResult] = await Promise.all([
    fetchIndexLeg("SPY", timeframe, deps),
    fetchIndexLeg("QQQ", timeframe, deps),
  ]);

  if (!spyResult.ok) {
    return { status: "WAIT_DATA", reason: spyResult.reason };
  }

  if (!qqqResult.ok) {
    return { status: "WAIT_DATA", reason: qqqResult.reason };
  }

  return {
    status: "READY",
    data: {
      spy: spyResult.leg,
      qqq: qqqResult.leg,
    },
  };
}
