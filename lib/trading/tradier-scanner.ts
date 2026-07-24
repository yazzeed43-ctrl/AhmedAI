import {
  getTradierExpirations,
  getTradierOptionChain,
  getTradierQuotes,
  type TradierOption,
  type TradierQuote,
} from "./tradier-client";

import { scoreOption } from "@/lib/fahd/option-brain";

import { getIVMetrics, saveIVHistory } from "@/lib/fahd/iv-history";

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
  IVContext,
  TradierOpportunity,
  BaseOpportunity,
} from "./tradier-scanner-core/types";

import {
  daysToExpiration,
  numberOr,
  nullableNumber,
  quotePrice,
  normalizeTier,
  clampScore,
} from "./tradier-scanner-core/utils";

const MIN_IV_SAMPLES = 10;

function emptyIVContext(): IVContext {
  return {
    ivRank: null,
    ivPercentile: null,
    samples: 0,
    signal: "INSUFFICIENT_DATA",
    scoreAdjustment: 0,
  };
}

function buildIVContext(
  ivRank: number,
  ivPercentile: number,
  samples: number,
): IVContext {
  if (samples < MIN_IV_SAMPLES) {
    return {
      ivRank,
      ivPercentile,
      samples,
      signal: "INSUFFICIENT_DATA",
      scoreAdjustment: 0,
    };
  }

  if (ivRank >= 80 || ivPercentile >= 80) {
    return {
      ivRank,
      ivPercentile,
      samples,
      signal: "HIGH",
      scoreAdjustment: -5,
    };
  }

  if (ivRank <= 20 && ivPercentile <= 25) {
    return {
      ivRank,
      ivPercentile,
      samples,
      signal: "LOW",
      scoreAdjustment: 4,
    };
  }

  return {
    ivRank,
    ivPercentile,
    samples,
    signal: "NORMAL",
    scoreAdjustment: 2,
  };
}

function scoreContract(
  option: TradierOption,
  quote: TradierQuote,
): BaseOpportunity | null {
  const underlyingPrice = quotePrice(quote);

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

async function enrichWithIVHistory(
  item: BaseOpportunity,
): Promise<Omit<TradierOpportunity, "rank">> {
  if (
    item.impliedVolatility === null ||
    !Number.isFinite(item.impliedVolatility)
  ) {
    return {
      ...item,
      ivContext: emptyIVContext(),
    };
  }

  try {
    const metrics = await getIVMetrics(
      item.contractSymbol,
      item.impliedVolatility,
    );

    const ivContext = buildIVContext(
      metrics.ivRank,
      metrics.ivPercentile,
      metrics.samples,
    );

    const score = clampScore(item.score + ivContext.scoreAdjustment);

    const reasons = [...item.reasons];

    const warnings = [...item.warnings];

    if (ivContext.signal === "LOW") {
      reasons.push("IV is low versus contract history");
    } else if (ivContext.signal === "NORMAL") {
      reasons.push("IV is within a normal historical range");
    } else if (ivContext.signal === "HIGH") {
      warnings.push("IV is elevated versus contract history");
    } else {
      warnings.push("Insufficient IV history for reliable rank");
    }

    await saveIVHistory({
      contractSymbol: item.contractSymbol,
      underlying: item.underlying,
      expiration: item.expiration,
      strike: item.strike,
      optionType: item.direction,
      impliedVolatility: item.impliedVolatility,
    });

    return {
      ...item,
      score,
      tier: normalizeTier(score),
      reasons,
      warnings,
      ivContext,
    };
  } catch {
    return {
      ...item,
      ivContext: emptyIVContext(),
      warnings: [...item.warnings, "IV history service unavailable"],
    };
  }
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

  const quotes = await getTradierQuotes(symbols);

  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));

  const opportunities: BaseOpportunity[] = [];

  let contractsScanned = 0;

  for (const symbol of symbols) {
    const quote = quoteMap.get(symbol);

    if (!quote || quotePrice(quote) <= 0) {
      continue;
    }

    const expirations = (await getTradierExpirations(symbol))
      .filter((date) => daysToExpiration(date) <= maxDte)
      .slice(0, expirationLimit);

    for (const expiration of expirations) {
      const chain = await getTradierOptionChain(symbol, expiration);

      contractsScanned += chain.length;

      for (const option of chain) {
        const item = scoreContract(option, quote);

        if (!item) {
          continue;
        }

        const absDelta = item.delta === null ? 0 : Math.abs(item.delta);

        if (
          item.midpoint < minPrice ||
          item.midpoint > maxPrice ||
          item.volume < minVolume ||
          item.openInterest < minOpenInterest ||
          item.spreadPercent > maxSpread ||
          absDelta < minDelta ||
          absDelta > maxDelta ||
          item.optionBrain.tier === "REJECT"
        ) {
          continue;
        }

        opportunities.push(item);
      }
    }
  }

  const shortlistLimit = Math.min(
    opportunities.length,
    Math.max(resultLimit * 3, 10),
  );

  const shortlist = opportunities
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.optionBrain.metrics.activityScore -
          first.optionBrain.metrics.activityScore ||
        second.volume - first.volume ||
        second.openInterest - first.openInterest,
    )
    .slice(0, shortlistLimit);

  const enriched = await Promise.all(shortlist.map(enrichWithIVHistory));

  const ranked: TradierOpportunity[] = enriched
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.optionBrain.metrics.activityScore -
          first.optionBrain.metrics.activityScore ||
        second.volume - first.volume ||
        second.openInterest - first.openInterest,
    )
    .slice(0, resultLimit)
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));

  return {
    source: "Tradier Brokerage API",
    engine: "Fahd Option Brain V2 + IV History",
    generatedAt: new Date().toISOString(),
    symbolsScanned: symbols,
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
