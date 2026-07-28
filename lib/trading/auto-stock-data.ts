import type { RawStockData } from "./signal-normalizer";
import type { StockTriggerLevels } from "./stock-trigger-adapter";
import { getTechnicalIndicators } from "@/lib/market-indicators";
import { getTradierQuote } from "@/lib/tradier";

// الخطوة (ب) من بناء analyze_trade التلقائي: تجمع بيانات رمز محدد
// (RawStockData) وتشتق منها StockTriggerLevels الجاهزة لتُمرَّر مباشرة
// لـstock-trigger-adapter. الحقول غير المتوفرة من مصدر عام بالمشروع
// حاليًا (ema200, adx, relativeStrength, catalyst) تُترك null/undefined
// بدل اختراعها — هي حقول اختيارية أصلًا بـRawStockData.

export type StockDataResult =
  | {
      status: "READY";
      stock: RawStockData;
      triggerLevels: StockTriggerLevels;
    }
  | { status: "WAIT_DATA"; reason: string };

export interface StockDataDeps {
  getIndicators: typeof getTechnicalIndicators;
  getQuote: typeof getTradierQuote;
}

const defaultStockDataDeps: StockDataDeps = {
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

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().trim();
}

export async function fetchStockData(
  symbol: string,
  timeframe: string = "15min",
  deps: StockDataDeps = defaultStockDataDeps
): Promise<StockDataResult> {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(normalizedSymbol)) {
    return { status: "WAIT_DATA", reason: "صيغة رمز السهم غير صحيحة" };
  }

  const [indicators, quote] = await Promise.all([
    deps.getIndicators(normalizedSymbol, timeframe),
    deps.getQuote(normalizedSymbol),
  ]);

  const indicatorsFailed = hasError(indicators);
  const quoteFailed = hasError(quote);

  const price =
    (!quoteFailed ? num((quote as any)?.last) : null) ??
    (!quoteFailed ? num((quote as any)?.close) : null) ??
    (!indicatorsFailed ? num((indicators as any)?.lastPrice) : null);

  if (price === null) {
    return {
      status: "WAIT_DATA",
      reason: `تعذّر جلب سعر ${normalizedSymbol}${
        indicatorsFailed ? `: ${(indicators as any).error}` : ""
      }${quoteFailed ? `: ${(quote as any).error}` : ""}`,
    };
  }

  const metrics = !indicatorsFailed
    ? (indicators as any)?.stockMetrics
    : null;

  const sr = !indicatorsFailed
    ? (indicators as any)?.supportResistance
    : null;

  const rsi = !indicatorsFailed
    ? num((indicators as any)?.rsi?.value)
    : null;

  const macdHistogram = !indicatorsFailed
    ? num((indicators as any)?.macd?.histogram)
    : null;

  // val/vah يفضّلان Volume Profile الحقيقي، وإلا يتراجعان لـ
  // support/resistance — نفس تحويل readLevels() المستخدم أصلًا بـ
  // stock-decision-engine.ts، حفاظًا على قاعدة موحّدة بالمشروع.
  const support = sr ? num(sr.support) : null;
  const resistance = sr ? num(sr.resistance) : null;
  const val = sr ? (num(sr.val) ?? support) : null;
  const vah = sr ? (num(sr.vah) ?? resistance) : null;
  const poc = sr ? num(sr.poc) : null;

  const stock: RawStockData = {
    symbol: normalizedSymbol,
    price,
    vwap: metrics ? num(metrics.vwap) : null,
    ema20: metrics ? num(metrics.ema20) : null,
    ema50: metrics ? num(metrics.ema50) : null,
    ema200: null, // غير متوفر من مصدر عام حاليًا
    rsi,
    macdHistogram,
    adx: null, // غير متوفر من مصدر عام حاليًا
    relativeVolume: metrics ? num(metrics.relativeVolume) : null,
    volume: metrics ? num(metrics.volume) : null,
    averageVolume: metrics ? num(metrics.averageVolume20) : null,
    poc,
    vah,
    val,
    support,
    resistance,
    relativeStrength: null, // غير متوفر من مصدر عام حاليًا
  };

  const triggerLevels: StockTriggerLevels = {
    price,
    vwap: stock.vwap,
    poc: stock.poc,
    vah: stock.vah,
    val: stock.val,
    support: stock.support,
    resistance: stock.resistance,
  };

  return { status: "READY", stock, triggerLevels };
}
