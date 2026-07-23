import { getMarketDecision } from "@/lib/market-decision-engine";
import {
  getTradierOptionChain,
  getTradierQuotes,
  type TradierOption,
} from "./tradier-client";
import {
  scoreOption as scoreOptionBrain,
  type OptionBrainInput,
} from "@/lib/fahd/option-brain";

type Direction = "CALL" | "PUT";

export interface SpxwScannerV3Config {
  expiration?: string;
  maxDte?: number;
  maxResults?: number;
  minimumFinalScore?: number;
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  minOpenInterest?: number;
  maxSpreadPercent?: number;
  minDelta?: number;
  maxDelta?: number;
}

function n(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionRoot(symbol: string): string {
  const match = symbol.toUpperCase().match(/^([A-Z]+)\d{6}[CP]\d{8}$/);

  return match?.[1] ?? "UNKNOWN";
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextWeekdays(count = 8): string[] {
  const dates: string[] = [];
  const cursor = new Date();

  while (dates.length < count) {
    const day = cursor.getUTCDay();

    if (day !== 0 && day !== 6) {
      dates.push(toYmd(cursor));
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function daysToExpiration(expiration: string): number {
  const end = new Date(`${expiration}T20:00:00Z`).getTime();

  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

function scoreOption(option: TradierOption, underlyingPrice: number) {
  const bid = n(option.bid);

  const ask = n(option.ask);

  if (bid <= 0 || ask <= 0 || ask < bid || underlyingPrice <= 0) {
    return null;
  }

  const midpoint = (bid + ask) / 2;

  const delta =
    typeof option.greeks?.delta === "number" ? option.greeks.delta : null;

  const gamma =
    typeof option.greeks?.gamma === "number" ? option.greeks.gamma : null;

  const theta =
    typeof option.greeks?.theta === "number" ? option.greeks.theta : null;

  const vega =
    typeof option.greeks?.vega === "number" ? option.greeks.vega : null;

  const impliedVolatility =
    typeof option.greeks?.mid_iv === "number"
      ? option.greeks.mid_iv
      : (option.greeks?.smv_vol ?? null);

  const volume = n(option.volume);

  const openInterest = n(option.open_interest);

  const dte = daysToExpiration(option.expiration_date);

  const direction: Direction = option.option_type === "call" ? "CALL" : "PUT";

  const brainInput: OptionBrainInput = {
    direction,
    underlyingPrice,
    strike: option.strike,
    daysToExpiration: dte,
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
  };

  const brain = scoreOptionBrain(brainInput);

  return {
    contractSymbol: option.symbol,
    root: optionRoot(option.symbol),
    direction,
    expiration: option.expiration_date,
    daysToExpiration: dte,
    strike: option.strike,
    bid,
    ask,
    midpoint: Number(midpoint.toFixed(2)),
    spreadPercent: brain.metrics.spreadPercent,
    delta,
    theta,
    impliedVolatility,
    volume,
    openInterest,
    proximityPercent: brain.metrics.moneynessPercent,
    contractScore: brain.score,
    optionBrainTier: brain.tier,
    optionBrainReasons: brain.reasons,
    optionBrainWarnings: brain.warnings,
  };
}

async function discoverDailyExpirations(maxDte: number): Promise<
  {
    expiration: string;
    contracts: TradierOption[];
  }[]
> {
  const candidates = nextWeekdays(10).filter(
    (expiration) => daysToExpiration(expiration) <= maxDte,
  );

  const results = await Promise.all(
    candidates.map(async (expiration) => {
      try {
        const contracts = await getTradierOptionChain("SPX", expiration);

        return {
          expiration,
          contracts,
        };
      } catch {
        return {
          expiration,
          contracts: [] as TradierOption[],
        };
      }
    }),
  );

  return results.filter((item) =>
    item.contracts.some((contract) => optionRoot(contract.symbol) === "SPXW"),
  );
}

export async function scanSpxwOpportunitiesV3(
  config: SpxwScannerV3Config = {},
) {
  const market = await getMarketDecision("15min");

  const direction: Direction | null =
    market.bias === "CALL_BIAS"
      ? "CALL"
      : market.bias === "PUT_BIAS"
        ? "PUT"
        : null;

  if (!direction) {
    return {
      status: "WAIT",
      market,
      opportunities: [],
      message: "اتجاه السوق غير مؤكد؛ لا توجد فرصة SPXW.",
    };
  }

  const quote = (await getTradierQuotes(["SPX"]))[0];

  const underlyingPrice =
    n(quote?.last) ||
    (n(quote?.bid) > 0 && n(quote?.ask) > 0
      ? (n(quote?.bid) + n(quote?.ask)) / 2
      : n(quote?.close));

  if (underlyingPrice <= 0) {
    throw new Error("تعذر جلب سعر SPX من Tradier.");
  }

  const maxDte = Math.max(0, Math.floor(config.maxDte ?? 10));

  const discovered = config.expiration
    ? daysToExpiration(config.expiration) <= maxDte
      ? [
          {
            expiration: config.expiration,
            contracts: await getTradierOptionChain("SPX", config.expiration),
          },
        ]
      : []
    : await discoverDailyExpirations(maxDte);

  const all = discovered.flatMap((item) => item.contracts);

  const spxw = all.filter((option) => optionRoot(option.symbol) === "SPXW");

  const minPrice = config.minPrice ?? 0.5;

  const maxPrice = config.maxPrice ?? 20;

  const minVolume = config.minVolume ?? 50;

  const minOpenInterest = config.minOpenInterest ?? 100;

  const maxSpread = config.maxSpreadPercent ?? 12;

  const minDelta = config.minDelta ?? 0.45;

  const maxDelta = config.maxDelta ?? 0.7;

  const minimumFinalScore = config.minimumFinalScore ?? 72;

  const marketScore =
    direction === "CALL"
      ? market.probabilities.bullish
      : market.probabilities.bearish;

  const opportunities = spxw
    .map((option) => scoreOption(option, underlyingPrice))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter(
      (item) =>
        item.direction === direction &&
        item.daysToExpiration <= maxDte &&
        item.midpoint >= minPrice &&
        item.midpoint <= maxPrice &&
        item.volume >= minVolume &&
        item.openInterest >= minOpenInterest &&
        item.spreadPercent <= maxSpread &&
        Math.abs(item.delta ?? 0) >= minDelta &&
        Math.abs(item.delta ?? 0) <= maxDelta,
    )
    .map((item) => ({
      ...item,
      underlying: "SPX",
      underlyingPrice: Number(underlyingPrice.toFixed(2)),
      marketBias: market.bias,
      marketScore,
      finalScore: Math.round(item.contractScore * 0.6 + marketScore * 0.4),
      triggerStatus: "WAIT_TRIGGER" as const,
    }))
    .filter((item) => item.finalScore >= minimumFinalScore)
    .sort(
      (first, second) =>
        second.finalScore - first.finalScore ||
        second.volume - first.volume ||
        second.openInterest - first.openInterest,
    )
    .slice(0, Math.max(1, Math.min(2, config.maxResults ?? 2)))
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));

  return {
    generatedAt: new Date().toISOString(),
    status: opportunities.length ? "OPPORTUNITIES_FOUND" : "NO_MATCH",
    source: "Tradier SPX chains filtered to SPXW",
    market,
    underlyingPrice: Number(underlyingPrice.toFixed(2)),
    expirationsScanned: discovered.map((item) => item.expiration),
    contractsScanned: all.length,
    spxwContractsFound: spxw.length,
    opportunities,
    message: opportunities.length
      ? `وجد فهد ${opportunities.length} فرصة SPXW متوافقة مع السوق.`
      : "تم العثور على عقود SPXW، لكن لا يوجد عقد يحقق شروط الجودة الآن.",
  };
}
