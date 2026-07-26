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
import {
  scanExpirationCandidates,
  summarizeExpirationScans,
  type ExpirationScanResult,
} from "./spxw-scan-completeness";
import {
  buildSpxPriceSnapshot,
  type SpxPriceSnapshot,
} from "./spx-price-freshness";
import type { AnalysisMode } from "./fahd-decision/spxw-analysis-mode";

type Direction = "CALL" | "PUT";

export interface SpxwScannerV3Config {
  analysisMode?: AnalysisMode;
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

// السعر الحقيقي لـ SPX من Tradier مباشرة، بدون استخدام SPY كبديل.
// تستخدمها أداة الفحص ومحرك التريغر حتى يكون مصدر السعر موحدًا.
export async function getRealSpxPriceSnapshot(): Promise<SpxPriceSnapshot> {
  const quotes = await getTradierQuotes(["SPX"]);

  const quote = quotes.find((item) => item.symbol?.toUpperCase() === "SPX");
  const snapshot = quote ? buildSpxPriceSnapshot(quote) : null;

  if (!snapshot) {
    throw new Error("تعذر جلب سعر SPX من Tradier.");
  }

  return snapshot;
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

async function discoverDailyExpirations(
  maxDte: number,
): Promise<ExpirationScanResult[]> {
  const candidates = nextWeekdays(10).filter(
    (expiration) => daysToExpiration(expiration) <= maxDte,
  );

  return scanExpirationCandidates(candidates, getTradierOptionChain);
}

export async function scanSpxwOpportunitiesV3(
  config: SpxwScannerV3Config = {},
) {
  const market = await getMarketDecision("15min");

  const liveDirection: Direction | null =
    market.bias === "CALL_BIAS"
      ? "CALL"
      : market.bias === "PUT_BIAS"
        ? "PUT"
        : null;

  const directions: Direction[] =
    config.analysisMode === "PREMARKET_PREP"
      ? ["CALL", "PUT"]
      : liveDirection
        ? [liveDirection]
        : [];

  if (!directions.length) {
    return {
      status: "WAIT",
      market,
      expirationsRequested: 0,
      expirationsSucceeded: 0,
      expirationsFailed: 0,
      providerErrors: [],
      opportunities: [],
      message: "اتجاه السوق غير مؤكد؛ لا توجد فرصة SPXW.",
    };
  }

  const underlyingQuote = await getRealSpxPriceSnapshot();
  const underlyingPrice = underlyingQuote.price;

  const maxDte = Math.max(0, Math.floor(config.maxDte ?? 10));

  const expirationResults: ExpirationScanResult[] = config.expiration
    ? daysToExpiration(config.expiration) <= maxDte
      ? await scanExpirationCandidates(
          [config.expiration],
          getTradierOptionChain,
        )
      : []
    : await discoverDailyExpirations(maxDte);

  const successfulScans = expirationResults.filter(
    (
      result,
    ): result is Extract<ExpirationScanResult, { status: "SUCCESS" }> =>
      result.status === "SUCCESS",
  );

  const discovered = successfulScans.filter((item) =>
    item.contracts.some((contract) => optionRoot(contract.symbol) === "SPXW"),
  );

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

  const marketScoreFor = (direction: Direction) =>
    direction === "CALL"
      ? market.probabilities.bullish
      : market.probabilities.bearish;

  const filterCriteria = {
    minPrice,
    maxPrice,
    minVolume,
    minOpenInterest,
    maxSpreadPercent: maxSpread,
    minDelta,
    maxDelta,
    minimumFinalScore,
  };

  const opportunities = spxw
    .map((option) => scoreOption(option, underlyingPrice))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter(
      (item) =>
        directions.includes(item.direction) &&
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
      marketScore: marketScoreFor(item.direction),
      finalScore: Math.round(
        item.contractScore * 0.6 + marketScoreFor(item.direction) * 0.4,
      ),
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

  const completeness = summarizeExpirationScans(
    expirationResults,
    opportunities.length,
  );

  const message =
    completeness.status === "DATA_PROVIDER_ERROR"
      ? completeness.providerErrors.some(
          (error) => error.code === "NO_EXPIRATIONS_AVAILABLE",
        )
        ? "تعذر إكمال مسح SPXW لعدم توفر استحقاقات قابلة للمسح حاليًا. لم يتم بناء خطة دخول."
        : "تعذر إكمال مسح SPXW بسبب فشل بيانات Tradier. لم يتم بناء خطة دخول."
      : completeness.status === "PARTIAL_DATA"
        ? "اكتمل جزء فقط من مسح SPXW بسبب فشل بعض طلبات Tradier. النتائج جزئية وللتشخيص فقط، ولم يتم بناء خطة دخول."
        : opportunities.length
          ? `وجد فهد ${opportunities.length} فرصة SPXW متوافقة مع السوق.`
          : "تم العثور على عقود SPXW، لكن لا يوجد عقد يحقق شروط الجودة الآن.";

  return {
    generatedAt: new Date().toISOString(),
    status: completeness.status,
    source: "Tradier SPX chains filtered to SPXW",
    market,
    underlyingPrice: Number(underlyingPrice.toFixed(2)),
    tradeDate: underlyingQuote.tradeDate,
    ageSeconds: underlyingQuote.ageSeconds,
    freshness: underlyingQuote.freshness,
    underlyingQuote: {
      ...underlyingQuote,
      price: Number(underlyingQuote.price.toFixed(2)),
    },
    expirationsScanned: discovered.map((item) => item.expiration),
    expirationsRequested: completeness.expirationsRequested,
    expirationsSucceeded: completeness.expirationsSucceeded,
    expirationsFailed: completeness.expirationsFailed,
    providerErrors: completeness.providerErrors,
    contractsScanned: all.length,
    spxwContractsFound: spxw.length,
    filterCriteria,
    rejectionReasons:
      opportunities.length === 0
        ? [
            "لم يجتز أي عقد جميع فلاتر الاتجاه وDelta والسعر والحجم وOpen Interest والسبريد وfinalScore الحالية.",
          ]
        : [],
    opportunities,
    message,
  };
}
