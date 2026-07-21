import {
  getTradierExpirations,
  getTradierOptionChain,
  getTradierQuotes,
  type TradierOption,
  type TradierQuote,
} from "./tradier-client";

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
  theta: number | null;
  impliedVolatility: number | null;
  volume: number;
  openInterest: number;
  proximityPercent: number;
  score: number;
  reasons: string[];
  warnings: string[];
}

const DAY_MS = 86_400_000;

function daysToExpiration(expiration: string): number {
  const end = new Date(`${expiration}T20:00:00Z`).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
}

function numberOr(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function quotePrice(quote: TradierQuote): number {
  return numberOr(
    quote.last,
    numberOr(quote.bid) > 0 && numberOr(quote.ask) > 0
      ? (numberOr(quote.bid) + numberOr(quote.ask)) / 2
      : numberOr(quote.close),
  );
}

function scoreContract(
  option: TradierOption,
  quote: TradierQuote,
): Omit<TradierOpportunity, "rank"> | null {
  const underlyingPrice = quotePrice(quote);
  const bid = numberOr(option.bid);
  const ask = numberOr(option.ask);
  if (underlyingPrice <= 0 || bid <= 0 || ask <= 0 || ask < bid) return null;

  const midpoint = (bid + ask) / 2;
  const spreadPercent = midpoint > 0 ? ((ask - bid) / midpoint) * 100 : 999;
  const delta =
    typeof option.greeks?.delta === "number" ? option.greeks.delta : null;
  const absDelta = delta === null ? null : Math.abs(delta);
  const theta =
    typeof option.greeks?.theta === "number" ? option.greeks.theta : null;
  const iv =
    typeof option.greeks?.mid_iv === "number"
      ? option.greeks.mid_iv
      : typeof option.greeks?.smv_vol === "number"
        ? option.greeks.smv_vol
        : null;
  const volume = numberOr(option.volume);
  const openInterest = numberOr(option.open_interest);
  const dte = daysToExpiration(option.expiration_date);
  const proximityPercent =
    Math.abs(option.strike - underlyingPrice) / underlyingPrice * 100;

  let score = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (spreadPercent <= 5) {
    score += 24;
    reasons.push("سبريد ممتاز");
  } else if (spreadPercent <= 8) {
    score += 20;
    reasons.push("سبريد جيد");
  } else if (spreadPercent <= 12) {
    score += 14;
  } else if (spreadPercent <= 20) {
    score += 7;
    warnings.push("السبريد واسع نسبيًا");
  } else {
    warnings.push("السبريد واسع");
  }

  if (volume >= 1000) {
    score += 18;
    reasons.push("حجم عقود مرتفع");
  } else if (volume >= 500) {
    score += 15;
  } else if (volume >= 100) {
    score += 10;
  } else if (volume >= 25) {
    score += 5;
  } else {
    warnings.push("حجم العقود منخفض");
  }

  if (openInterest >= 5000) {
    score += 18;
    reasons.push("Open Interest قوي");
  } else if (openInterest >= 1000) {
    score += 15;
  } else if (openInterest >= 500) {
    score += 11;
  } else if (openInterest >= 100) {
    score += 6;
  } else {
    warnings.push("Open Interest منخفض");
  }

  if (absDelta !== null && absDelta >= 0.5 && absDelta <= 0.7) {
    score += 20;
    reasons.push("Delta مثالية للمضاربة");
  } else if (absDelta !== null && absDelta >= 0.4 && absDelta <= 0.8) {
    score += 13;
  } else {
    warnings.push("Delta خارج النطاق المفضل");
  }

  if (proximityPercent <= 0.5) {
    score += 12;
    reasons.push("قريب جدًا من ATM");
  } else if (proximityPercent <= 1) {
    score += 9;
  } else if (proximityPercent <= 2) {
    score += 5;
  } else {
    warnings.push("العقد بعيد عن السعر");
  }

  if (dte >= 2 && dte <= 5) {
    score += 8;
    reasons.push("استحقاق مناسب للمضاربة");
  } else if (dte >= 1 && dte <= 7) {
    score += 5;
  } else if (dte === 0) {
    warnings.push("0DTE عالي الخطورة");
  }

  const change = numberOr(quote.change_percentage, 0);
  const directionMatches =
    (option.option_type === "call" && change > 0) ||
    (option.option_type === "put" && change < 0);
  if (Math.abs(change) >= 0.25 && directionMatches) {
    score += 5;
    reasons.push("متوافق مع حركة الأصل الحالية");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = score >= 85 ? "GOLD" : score >= 72 ? "STRONG" : "WATCH";

  return {
    tier,
    underlying: quote.symbol,
    underlyingPrice: Number(underlyingPrice.toFixed(2)),
    underlyingChangePercent:
      typeof quote.change_percentage === "number"
        ? quote.change_percentage
        : null,
    direction: option.option_type === "call" ? "CALL" : "PUT",
    contractSymbol: option.symbol,
    expiration: option.expiration_date,
    daysToExpiration: dte,
    strike: option.strike,
    bid,
    ask,
    midpoint: Number(midpoint.toFixed(2)),
    spreadPercent: Number(spreadPercent.toFixed(1)),
    last: typeof option.last === "number" ? option.last : null,
    delta,
    theta,
    impliedVolatility: iv,
    volume,
    openInterest,
    proximityPercent: Number(proximityPercent.toFixed(2)),
    score,
    reasons,
    warnings,
  };
}

export async function scanTradierOpportunities(
  config: TradierScannerConfig,
) {
  const symbols = [...new Set(config.symbols.map((s) => s.trim().toUpperCase()))]
    .filter(Boolean)
    .slice(0, 20);

  const maxDte = config.maxDte ?? 7;
  const expirationLimit = config.expirationsPerSymbol ?? 2;
  const resultLimit = Math.min(20, Math.max(1, config.results ?? 5));
  const minPrice = config.minPrice ?? 0.30;
  const maxPrice = config.maxPrice ?? 15;
  const minVolume = config.minVolume ?? 25;
  const minOpenInterest = config.minOpenInterest ?? 100;
  const maxSpread = config.maxSpreadPercent ?? 20;
  const minDelta = config.minDelta ?? 0.35;
  const maxDelta = config.maxDelta ?? 0.80;

  const quotes = await getTradierQuotes(symbols);
  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const opportunities: Omit<TradierOpportunity, "rank">[] = [];
  let contractsScanned = 0;

  for (const symbol of symbols) {
    const quote = quoteMap.get(symbol);
    if (!quote || quotePrice(quote) <= 0) continue;

    const expirations = (await getTradierExpirations(symbol))
      .filter((date) => daysToExpiration(date) <= maxDte)
      .slice(0, expirationLimit);

    for (const expiration of expirations) {
      const chain = await getTradierOptionChain(symbol, expiration);
      contractsScanned += chain.length;

      for (const option of chain) {
        const item = scoreContract(option, quote);
        if (!item) continue;

        const absDelta = item.delta === null ? 0 : Math.abs(item.delta);

        if (
          item.midpoint < minPrice ||
          item.midpoint > maxPrice ||
          item.volume < minVolume ||
          item.openInterest < minOpenInterest ||
          item.spreadPercent > maxSpread ||
          absDelta < minDelta ||
          absDelta > maxDelta
        ) {
          continue;
        }

        opportunities.push(item);
      }
    }
  }

  const ranked: TradierOpportunity[] = opportunities
    .sort((a, b) =>
      b.score - a.score ||
      b.volume - a.volume ||
      b.openInterest - a.openInterest
    )
    .slice(0, resultLimit)
    .map((item, index) => ({ rank: index + 1, ...item }));

  return {
    source: "Tradier Brokerage API",
    generatedAt: new Date().toISOString(),
    symbolsScanned: symbols,
    contractsScanned,
    qualifiedContracts: opportunities.length,
    opportunities: ranked,
    message:
      ranked.length > 0
        ? `تم العثور على ${ranked.length} من أفضل عقود الأوبشن المتاحة.`
        : "لا توجد عقود تحقق شروط السيولة والسبريد وDelta حاليًا.",
  };
}
