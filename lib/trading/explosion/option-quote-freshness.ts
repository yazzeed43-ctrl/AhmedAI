export type OptionQuoteFreshness = "live" | "delayed" | "stale" | "unknown";

export interface OptionQuoteLike {
  symbol: string;
  bid?: number | null;
  ask?: number | null;
  bid_date?: number | string | null;
  ask_date?: number | string | null;
}

export interface OptionQuoteSnapshot {
  contractSymbol: string;
  bid: number;
  ask: number;
  midpoint: number;
  bidDate: string | null;
  askDate: string | null;
  quoteTime: string | null;
  ageSeconds: number | null;
  freshness: OptionQuoteFreshness;
  timestampSource: "bid_ask_dates" | null;
  isCrossedMarket: false;
  isExecutableQuote: boolean;
}

const MAX_FUTURE_SKEW_SECONDS = 5;

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parsePreciseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  let date: Date;
  if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const numeric = Number(value);
    date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
  } else {
    date = new Date(String(value));
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildOptionQuoteSnapshot(
  quote: OptionQuoteLike,
  now = new Date(),
): OptionQuoteSnapshot | null {
  const bid = positiveNumber(quote.bid);
  const ask = positiveNumber(quote.ask);
  if (bid === null || ask === null || ask < bid) return null;

  const bidDate = parsePreciseTimestamp(quote.bid_date);
  const askDate = parsePreciseTimestamp(quote.ask_date);
  const quoteTime =
    bidDate && askDate
      ? new Date(Math.min(bidDate.getTime(), askDate.getTime()))
      : null;
  const rawAgeSeconds = quoteTime
    ? Math.floor((now.getTime() - quoteTime.getTime()) / 1_000)
    : null;
  const materiallyFuture =
    rawAgeSeconds !== null && rawAgeSeconds < -MAX_FUTURE_SKEW_SECONDS;
  const ageSeconds =
    rawAgeSeconds === null || materiallyFuture ? null : Math.max(0, rawAgeSeconds);
  const freshness: OptionQuoteFreshness =
    ageSeconds === null
      ? "unknown"
      : ageSeconds <= 60
        ? "live"
        : ageSeconds <= 20 * 60
          ? "delayed"
          : "stale";

  return {
    contractSymbol: quote.symbol.trim().toUpperCase(),
    bid,
    ask,
    midpoint: Math.round(((bid + ask) / 2) * 100) / 100,
    bidDate: bidDate?.toISOString() ?? null,
    askDate: askDate?.toISOString() ?? null,
    quoteTime: materiallyFuture ? null : quoteTime?.toISOString() ?? null,
    ageSeconds,
    freshness,
    timestampSource: quoteTime && !materiallyFuture ? "bid_ask_dates" : null,
    isCrossedMarket: false,
    isExecutableQuote: freshness === "live",
  };
}

export function mapOptionQuoteDataStatus(
  snapshot: OptionQuoteSnapshot | null | undefined,
): "FRESH" | "STALE" | "MISSING" {
  if (!snapshot || snapshot.freshness === "unknown") return "MISSING";
  return snapshot.freshness === "live" ? "FRESH" : "STALE";
}
