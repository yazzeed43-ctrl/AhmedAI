export type SpxPriceFreshness = "live" | "delayed" | "stale" | "unknown";
export type SpxPriceSource = "last" | "midpoint" | "close";
export type SpxPriceTimestampSource =
  | "trade_date"
  | "bid_ask_dates"
  | null;

export interface SpxPriceSnapshot {
  price: number;
  priceSource: SpxPriceSource;
  tradeDate: string | null;
  ageSeconds: number | null;
  freshness: SpxPriceFreshness;
  timestampSource: SpxPriceTimestampSource;
}

interface QuoteLike {
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
  close?: number | null;
  trade_date?: number | string | null;
  bid_date?: number | string | null;
  ask_date?: number | string | null;
}

const LIVE_MAX_AGE_SECONDS = 60;
const DELAYED_MAX_AGE_SECONDS = 20 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 5;

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parseMarketTimestamp(
  value: number | string | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number") return null;

  const normalized = value.trim();
  if (!normalized || /^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  if (/^\d{10,13}$/.test(normalized)) {
    return parseMarketTimestamp(Number(normalized));
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveTimestamp(
  quote: QuoteLike,
  priceSource: SpxPriceSource,
): { date: Date | null; source: SpxPriceTimestampSource } {
  if (priceSource === "midpoint") {
    const bidDate = parseMarketTimestamp(quote.bid_date);
    const askDate = parseMarketTimestamp(quote.ask_date);

    // A midpoint is only as fresh as its older side. Requiring both timestamps
    // prevents an old bid (or ask) from being presented as a live midpoint.
    if (!bidDate || !askDate) return { date: null, source: null };

    return {
      date: bidDate.getTime() <= askDate.getTime() ? bidDate : askDate,
      source: "bid_ask_dates",
    };
  }

  const tradeDate = parseMarketTimestamp(quote.trade_date);
  return {
    date: tradeDate,
    source: tradeDate ? "trade_date" : null,
  };
}

function classifyFreshness(
  timestamp: Date | null,
  now: Date,
): { ageSeconds: number | null; freshness: SpxPriceFreshness } {
  if (!timestamp || Number.isNaN(now.getTime())) {
    return { ageSeconds: null, freshness: "unknown" };
  }

  const rawAgeSeconds = Math.floor(
    (now.getTime() - timestamp.getTime()) / 1_000,
  );

  if (rawAgeSeconds < -MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    return { ageSeconds: null, freshness: "unknown" };
  }

  const ageSeconds = Math.max(0, rawAgeSeconds);
  const freshness: SpxPriceFreshness =
    ageSeconds <= LIVE_MAX_AGE_SECONDS
      ? "live"
      : ageSeconds <= DELAYED_MAX_AGE_SECONDS
        ? "delayed"
        : "stale";

  return { ageSeconds, freshness };
}

export function buildSpxPriceSnapshot(
  quote: QuoteLike,
  now = new Date(),
): SpxPriceSnapshot | null {
  const last = positiveNumber(quote.last);
  const bid = positiveNumber(quote.bid);
  const ask = positiveNumber(quote.ask);
  const close = positiveNumber(quote.close);
  const hasValidMidpoint =
    bid !== null && ask !== null && ask >= bid;

  const price = last ?? (hasValidMidpoint ? (bid + ask) / 2 : close);
  if (price === null) return null;

  const priceSource: SpxPriceSource = last
    ? "last"
    : hasValidMidpoint
      ? "midpoint"
      : "close";

  const timestamp = resolveTimestamp(quote, priceSource);
  const { ageSeconds, freshness } = classifyFreshness(timestamp.date, now);

  return {
    price,
    priceSource,
    tradeDate: timestamp.date?.toISOString() ?? null,
    ageSeconds,
    freshness,
    timestampSource: timestamp.source,
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
