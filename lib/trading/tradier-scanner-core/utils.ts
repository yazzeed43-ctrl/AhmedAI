import type { TradierQuote } from "../tradier-client";
import type { TradierOpportunity } from "./types";

const DAY_MS = 86_400_000;

export function daysToExpiration(expiration: string): number {
  const end = new Date(`${expiration}T20:00:00Z`).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
}

export function numberOr(
  value: number | null | undefined,
  fallback = 0,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function nullableNumber(
  value: number | null | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function quotePrice(quote: TradierQuote): number {
  return numberOr(
    quote.last,
    numberOr(quote.bid) > 0 && numberOr(quote.ask) > 0
      ? (numberOr(quote.bid) + numberOr(quote.ask)) / 2
      : numberOr(quote.close),
  );
}

export function normalizeTier(score: number): TradierOpportunity["tier"] {
  if (score >= 85) {
    return "GOLD";
  }

  if (score >= 72) {
    return "STRONG";
  }

  return "WATCH";
}

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
