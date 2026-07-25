export type SpxPriceFreshness = "live" | "delayed" | "stale" | "unknown";
export type SpxPriceSource = "last" | "midpoint" | "close";

export interface SpxPriceSnapshot {
  price: number;
  priceSource: SpxPriceSource;
  tradeDate: string | null;
  ageSeconds: number | null;
  freshness: SpxPriceFreshness;
}

interface QuoteLike {
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
  close?: number | null;
  trade_date?: number | string | null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parseTradeDate(value: QuoteLike["trade_date"]): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildSpxPriceSnapshot(
  quote: QuoteLike,
  now = new Date(),
): SpxPriceSnapshot | null {
  const last = positiveNumber(quote.last);
  const bid = positiveNumber(quote.bid);
  const ask = positiveNumber(quote.ask);
  const close = positiveNumber(quote.close);

  const price = last ?? (bid !== null && ask !== null ? (bid + ask) / 2 : close);
  if (price === null) return null;

  const priceSource: SpxPriceSource = last
    ? "last"
    : bid !== null && ask !== null
      ? "midpoint"
      : "close";

  const parsedTradeDate = parseTradeDate(quote.trade_date);
  const ageSeconds = parsedTradeDate
    ? Math.max(0, Math.floor((now.getTime() - parsedTradeDate.getTime()) / 1_000))
    : null;

  const freshness: SpxPriceFreshness =
    ageSeconds === null
      ? "unknown"
      : ageSeconds <= 60
        ? "live"
        : ageSeconds <= 20 * 60
          ? "delayed"
          : "stale";

  return {
    price,
    priceSource,
    tradeDate: parsedTradeDate?.toISOString() ?? null,
    ageSeconds,
    freshness,
  };
}

export function canBuildSpxwTriggerFromQuote(
  snapshot: SpxPriceSnapshot | null | undefined,
): boolean {
  return Boolean(
    snapshot &&
      snapshot.freshness === "live" &&
      snapshot.priceSource !== "close",
  );
}
