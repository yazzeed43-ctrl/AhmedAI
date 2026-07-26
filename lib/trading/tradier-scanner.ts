import {
  getTradierExpirations,
  getTradierOptionChain,
  getTradierQuotes,
  type TradierOption,
  type TradierQuote,
} from "./tradier-client";

import { scoreOption } from "@/lib/fahd/option-brain";
import { buildSpxPriceSnapshot } from "./spx-price-freshness";

// الأنواع انتقلت لـ tradier-scanner-core/types.ts (خطوة 1 من خطة
// التقسيم). يُعاد تصديرها هنا حرفيًا بنفس الأسماء حتى ما ينكسر أي
// `import type { X } from "./tradier-scanner"` موجود بالمشروع.
export type {
  TradierScannerConfig,
  IVContext,
  TradierOpportunity,
  BaseOpportunity,
} from "./tradier-scanner-core/types";

import type {
  TradierScannerConfig,
  BaseOpportunity,
} from "./tradier-scanner-core/types";

import {
  daysToExpiration,
  numberOr,
  nullableNumber,
  quotePrice,
  normalizeTier,
} from "./tradier-scanner-core/utils";

import { enrichWithIVHistory } from "./tradier-scanner-core/iv-context";
import { passesContractFilters } from "./tradier-scanner-core/filters";
import {
  createShortlist,
  rankOpportunities,
} from "./tradier-scanner-core/ranking";
import { deriveTradierScanStatus } from "./tradier-scanner-core/completeness";

function scoreContract(
  option: TradierOption,
  quote: TradierQuote,
): BaseOpportunity | null {
  const underlyingPrice = quotePrice(quote);
  const priceSnapshot = buildSpxPriceSnapshot(quote);

  const bid = numberOr(option.bid);

  const ask = numberOr(option.ask);

  if (underlyingPrice <= 0 || bid <= 0 || ask <= 0 || ask < bid) {
    return null;
  }

  const midpoint = (bid + ask) / 2;

  const delta = nullableNumber(option.greeks?.delta);

  const gamma = nullableNumber(option.greeks?.gamma);

  const theta = nullableNumber(option.greeks?.theta);

  const vega = nullableNumber(option.greeks?.vega);

  const impliedVolatility =
    nullableNumber(option.greeks?.mid_iv) ??
    nullableNumber(option.greeks?.smv_vol);

  const volume = numberOr(option.volume);

  const openInterest = numberOr(option.open_interest);

  const daysToExpiry = daysToExpiration(option.expiration_date);

  const direction: "CALL" | "PUT" =
    option.option_type === "call" ? "CALL" : "PUT";

  const optionBrain = scoreOption({
    direction,
    underlyingPrice,
    strike: option.strike,
    daysToExpiration: daysToExpiry,
    bid,
    ask,
    midpoint,
    delta,
    gamma,
    theta,
    vega,
    impliedVolatility,
    volume,
    openInterest,
  });

  const reasons = [...optionBrain.reasons];

  const warnings = [...optionBrain.warnings];

  const underlyingChange = numberOr(quote.change_percentage, 0);

  const directionMatches =
    (direction === "CALL" && underlyingChange > 0) ||
    (direction === "PUT" && underlyingChange < 0);

  if (Math.abs(underlyingChange) >= 0.25 && directionMatches) {
    reasons.push("Direction matches current underlying move");
  } else if (Math.abs(underlyingChange) >= 0.25) {
    warnings.push("Contract direction conflicts with current underlying move");
  }

  return {
    tier: normalizeTier(optionBrain.score),
    underlying: quote.symbol,
    underlyingPrice: Number(underlyingPrice.toFixed(2)),
    underlyingChangePercent: nullableNumber(quote.change_percentage),
    priceSource: priceSnapshot?.priceSource ?? "unknown",
    tradeDate: priceSnapshot?.tradeDate ?? null,
    ageSeconds: priceSnapshot?.ageSeconds ?? null,
    freshness: priceSnapshot?.freshness ?? "unknown",
    direction,
    contractSymbol: option.symbol,
    expiration: option.expiration_date,
    daysToExpiration: daysToExpiry,
    strike: option.strike,
    bid,
    ask,
    midpoint: Number(midpoint.toFixed(2)),
    spreadPercent: optionBrain.metrics.spreadPercent,
    last: nullableNumber(option.last),
    delta,
    gamma,
    theta,
    vega,
    impliedVolatility,
    volume,
    openInterest,
    proximityPercent: optionBrain.metrics.moneynessPercent,
    score: optionBrain.score,
    reasons,
    warnings,
    optionBrain,
  };
}

export async function scanTradierOpportunities(config: TradierScannerConfig) {
  const symbols = [
    ...new Set(config.symbols.map((symbol) => symbol.trim().toUpperCase())),
  ]
    .filter(Boolean)
    .slice(0, 20);

  const maxDte = config.maxDte ?? 7;

  const expirationLimit = config.expirationsPerSymbol ?? 2;

  const resultLimit = Math.min(20, Math.max(1, config.results ?? 5));

  const minPrice = config.minPrice ?? 0.3;

  const maxPrice = config.maxPrice ?? 15;

  const minVolume = config.minVolume ?? 25;

  const minOpenInterest = config.minOpenInterest ?? 100;

  const maxSpread = config.maxSpreadPercent ?? 20;

  const minDelta = config.minDelta ?? 0.35;

  const maxDelta = config.maxDelta ?? 0.8;

  let quotes: TradierQuote[] = [];
  const providerErrors: Array<{
    symbol: string;
    expiration?: string;
    code: string;
    message: string;
  }> = [];
  try {
    quotes = await getTradierQuotes(symbols);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      source: "Tradier Brokerage API",
      engine: "Fahd Option Brain V2 + IV History",
      generatedAt: new Date().toISOString(),
      status: "DATA_PROVIDER_ERROR" as const,
      symbolsScanned: symbols,
      symbolsRequested: symbols.length,
      symbolsSucceeded: 0,
      symbolsFailed: symbols.length,
      expirationsRequested: 0,
      expirationsSucceeded: 0,
      expirationsFailed: 0,
      providerErrors: symbols.map((symbol) => ({
        symbol,
        code: /timeout|مهلة/i.test(message) ? "TIMEOUT" : "QUOTE_REQUEST_FAILED",
        message: "Tradier quote request failed",
      })),
      contractsScanned: 0,
      qualifiedContracts: 0,
      ivHistoryEnriched: 0,
      opportunities: [],
      message: "Tradier quote data was unavailable; the scan was not completed.",
    };
  }

  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));

  const opportunities: BaseOpportunity[] = [];

  let contractsScanned = 0;
  let symbolsSucceeded = 0;
  let symbolsFailed = 0;
  let expirationsRequested = 0;
  let expirationsSucceeded = 0;
  let expirationsFailed = 0;

  for (const symbol of symbols) {
    const quote = quoteMap.get(symbol);

    if (!quote || quotePrice(quote) <= 0) {
      symbolsFailed += 1;
      providerErrors.push({
        symbol,
        code: "QUOTE_UNAVAILABLE",
        message: "Tradier quote was unavailable",
      });
      continue;
    }

    let expirations: string[];
    try {
      expirations = (await getTradierExpirations(symbol))
        .filter((date) => daysToExpiration(date) <= maxDte)
        .slice(0, expirationLimit);
    } catch {
      symbolsFailed += 1;
      providerErrors.push({
        symbol,
        code: "EXPIRATIONS_REQUEST_FAILED",
        message: "Tradier options expirations request failed",
      });
      continue;
    }

    if (expirations.length === 0) {
      symbolsFailed += 1;
      providerErrors.push({
        symbol,
        code: "NO_EXPIRATIONS_AVAILABLE",
        message: "No eligible option expirations were available",
      });
      continue;
    }

    let symbolComplete = true;
    expirationsRequested += expirations.length;

    for (const expiration of expirations) {
      let chain: TradierOption[];
      try {
        chain = await getTradierOptionChain(symbol, expiration);
        expirationsSucceeded += 1;
      } catch {
        symbolComplete = false;
        expirationsFailed += 1;
        providerErrors.push({
          symbol,
          expiration,
          code: "CHAIN_REQUEST_FAILED",
          message: "Tradier options chain request failed",
        });
        continue;
      }

      contractsScanned += chain.length;

      for (const option of chain) {
        const item = scoreContract(option, quote);

        if (!item) {
          continue;
        }

        if (
          !passesContractFilters(item, {
            minPrice,
            maxPrice,
            minVolume,
            minOpenInterest,
            maxSpreadPercent: maxSpread,
            minDelta,
            maxDelta,
          })
        ) {
          continue;
        }

        opportunities.push(item);
      }
    }

    if (symbolComplete) symbolsSucceeded += 1;
    else symbolsFailed += 1;
  }

  const shortlist = createShortlist(opportunities, resultLimit);

  const enriched = await Promise.all(
    shortlist.map(async (item) => {
      try {
        return await enrichWithIVHistory(item);
      } catch {
        return {
          ...item,
          ivContext: {
            ivRank: null,
            ivPercentile: null,
            samples: 0,
            signal: "INSUFFICIENT_DATA" as const,
            scoreAdjustment: 0,
          },
          warnings: [
            ...item.warnings,
            "تعذر جلب سجل IV؛ لم يؤثر ذلك على اكتمال بيانات العقد الأساسية.",
          ],
        };
      }
    }),
  );

  const ranked = rankOpportunities(enriched, resultLimit);

  const status = deriveTradierScanStatus({
    symbolsRequested: symbols.length,
    symbolsSucceeded,
    symbolsFailed,
    opportunityCount: ranked.length,
  });

  return {
    source: "Tradier Brokerage API",
    engine: "Fahd Option Brain V2 + IV History",
    generatedAt: new Date().toISOString(),
    status,
    symbolsScanned: symbols,
    symbolsRequested: symbols.length,
    symbolsSucceeded,
    symbolsFailed,
    expirationsRequested,
    expirationsSucceeded,
    expirationsFailed,
    providerErrors,
    contractsScanned,
    qualifiedContracts: opportunities.length,
    ivHistoryEnriched: enriched.length,
    opportunities: ranked,
    message:
      ranked.length > 0
        ? `Found ${ranked.length} qualified option contracts.`
        : "No contracts passed Option Brain, liquidity, spread, and delta filters.",
  };
}
