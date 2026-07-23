import {
  getTradierExpirations,
  getTradierOptionChain,
  getTradierQuotes,
  type TradierOption,
  type TradierQuote,
} from "./tradier-client";

import {
  scoreOption,
  type OptionBrainResult,
} from "@/lib/fahd/option-brain";

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
}

const DAY_MS = 86_400_000;

function daysToExpiration(
  expiration: string
): number {
  const end = new Date(
    `${expiration}T20:00:00Z`
  ).getTime();

  return Math.max(
    0,
    Math.ceil(
      (end - Date.now()) / DAY_MS
    )
  );
}

function numberOr(
  value:
    | number
    | null
    | undefined,
  fallback = 0
): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : fallback;
}

function nullableNumber(
  value:
    | number
    | null
    | undefined
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function quotePrice(
  quote: TradierQuote
): number {
  return numberOr(
    quote.last,
    numberOr(quote.bid) > 0 &&
      numberOr(quote.ask) > 0
      ? (
          numberOr(quote.bid) +
          numberOr(quote.ask)
        ) / 2
      : numberOr(quote.close)
  );
}

function normalizeTier(
  tier: OptionBrainResult["tier"]
): TradierOpportunity["tier"] {
  if (tier === "GOLD") {
    return "GOLD";
  }

  if (tier === "STRONG") {
    return "STRONG";
  }

  return "WATCH";
}

function scoreContract(
  option: TradierOption,
  quote: TradierQuote
): Omit<
  TradierOpportunity,
  "rank"
> | null {
  const underlyingPrice =
    quotePrice(quote);

  const bid =
    numberOr(option.bid);

  const ask =
    numberOr(option.ask);

  if (
    underlyingPrice <= 0 ||
    bid <= 0 ||
    ask <= 0 ||
    ask < bid
  ) {
    return null;
  }

  const midpoint =
    (bid + ask) / 2;

  const delta =
    nullableNumber(
      option.greeks?.delta
    );

  const gamma =
    nullableNumber(
      option.greeks?.gamma
    );

  const theta =
    nullableNumber(
      option.greeks?.theta
    );

  const vega =
    nullableNumber(
      option.greeks?.vega
    );

  const impliedVolatility =
    nullableNumber(
      option.greeks?.mid_iv
    ) ??
    nullableNumber(
      option.greeks?.smv_vol
    );

  const volume =
    numberOr(option.volume);

  const openInterest =
    numberOr(
      option.open_interest
    );

  const daysToExpiry =
    daysToExpiration(
      option.expiration_date
    );

  const direction:
    | "CALL"
    | "PUT" =
    option.option_type === "call"
      ? "CALL"
      : "PUT";

  const optionBrain =
    scoreOption({
      direction,
      underlyingPrice,
      strike:
        option.strike,
      daysToExpiration:
        daysToExpiry,
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

  const proximityPercent =
    optionBrain.metrics
      .moneynessPercent;

  const spreadPercent =
    optionBrain.metrics
      .spreadPercent;

  const reasons = [
    ...optionBrain.reasons,
  ];

  const warnings = [
    ...optionBrain.warnings,
  ];

  const underlyingChange =
    numberOr(
      quote.change_percentage,
      0
    );

  const directionMatches =
    (
      direction === "CALL" &&
      underlyingChange > 0
    ) ||
    (
      direction === "PUT" &&
      underlyingChange < 0
    );

  if (
    Math.abs(
      underlyingChange
    ) >= 0.25 &&
    directionMatches
  ) {
    reasons.push(
      "متوافق مع حركة الأصل الحالية"
    );
  } else if (
    Math.abs(
      underlyingChange
    ) >= 0.25
  ) {
    warnings.push(
      "اتجاه العقد لا يتوافق مع حركة الأصل الحالية"
    );
  }

  return {
    tier:
      normalizeTier(
        optionBrain.tier
      ),
    underlying:
      quote.symbol,
    underlyingPrice:
      Number(
        underlyingPrice.toFixed(
          2
        )
      ),
    underlyingChangePercent:
      nullableNumber(
        quote.change_percentage
      ),
    direction,
    contractSymbol:
      option.symbol,
    expiration:
      option.expiration_date,
    daysToExpiration:
      daysToExpiry,
    strike:
      option.strike,
    bid,
    ask,
    midpoint:
      Number(
        midpoint.toFixed(2)
      ),
    spreadPercent,
    last:
      nullableNumber(
        option.last
      ),
    delta,
    gamma,
    theta,
    vega,
    impliedVolatility,
    volume,
    openInterest,
    proximityPercent,
    score:
      optionBrain.score,
    reasons,
    warnings,
    optionBrain,
  };
}

export async function scanTradierOpportunities(
  config: TradierScannerConfig
) {
  const symbols = [
    ...new Set(
      config.symbols.map(
        (symbol) =>
          symbol
            .trim()
            .toUpperCase()
      )
    ),
  ]
    .filter(Boolean)
    .slice(0, 20);

  const maxDte =
    config.maxDte ?? 7;

  const expirationLimit =
    config.expirationsPerSymbol ??
    2;

  const resultLimit =
    Math.min(
      20,
      Math.max(
        1,
        config.results ?? 5
      )
    );

  const minPrice =
    config.minPrice ?? 0.3;

  const maxPrice =
    config.maxPrice ?? 15;

  const minVolume =
    config.minVolume ?? 25;

  const minOpenInterest =
    config.minOpenInterest ??
    100;

  const maxSpread =
    config.maxSpreadPercent ??
    20;

  const minDelta =
    config.minDelta ?? 0.35;

  const maxDelta =
    config.maxDelta ?? 0.8;

  const quotes =
    await getTradierQuotes(
      symbols
    );

  const quoteMap =
    new Map(
      quotes.map(
        (quote) => [
          quote.symbol,
          quote,
        ]
      )
    );

  const opportunities:
    Omit<
      TradierOpportunity,
      "rank"
    >[] = [];

  let contractsScanned = 0;

  for (
    const symbol of symbols
  ) {
    const quote =
      quoteMap.get(symbol);

    if (
      !quote ||
      quotePrice(quote) <= 0
    ) {
      continue;
    }

    const expirations =
      (
        await getTradierExpirations(
          symbol
        )
      )
        .filter(
          (date) =>
            daysToExpiration(
              date
            ) <= maxDte
        )
        .slice(
          0,
          expirationLimit
        );

    for (
      const expiration
      of expirations
    ) {
      const chain =
        await getTradierOptionChain(
          symbol,
          expiration
        );

      contractsScanned +=
        chain.length;

      for (
        const option of chain
      ) {
        const item =
          scoreContract(
            option,
            quote
          );

        if (!item) {
          continue;
        }

        const absDelta =
          item.delta === null
            ? 0
            : Math.abs(
                item.delta
              );

        if (
          item.midpoint <
            minPrice ||
          item.midpoint >
            maxPrice ||
          item.volume <
            minVolume ||
          item.openInterest <
            minOpenInterest ||
          item.spreadPercent >
            maxSpread ||
          absDelta <
            minDelta ||
          absDelta >
            maxDelta ||
          item.optionBrain.tier ===
            "REJECT"
        ) {
          continue;
        }

        opportunities.push(
          item
        );
      }
    }
  }

  const ranked:
    TradierOpportunity[] =
    opportunities
      .sort(
        (first, second) =>
          second.score -
            first.score ||
          (
            second.optionBrain
              .metrics
              .activityScore -
            first.optionBrain
              .metrics
              .activityScore
          ) ||
          second.volume -
            first.volume ||
          second.openInterest -
            first.openInterest
      )
      .slice(
        0,
        resultLimit
      )
      .map(
        (item, index) => ({
          rank:
            index + 1,
          ...item,
        })
      );

  return {
    source:
      "Tradier Brokerage API",
    engine:
      "Fahd Option Brain V2",
    generatedAt:
      new Date().toISOString(),
    symbolsScanned:
      symbols,
    contractsScanned,
    qualifiedContracts:
      opportunities.length,
    opportunities:
      ranked,
    message:
      ranked.length > 0
        ? `تم العثور على ${ranked.length} من أفضل عقود الأوبشن المتاحة.`
        : "لا توجد عقود تحقق شروط Option Brain والسيولة والسبريد والدلتا حاليًا.",
  };
}