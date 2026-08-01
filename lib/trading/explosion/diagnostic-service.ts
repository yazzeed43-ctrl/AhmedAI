import {
  getTechnicalIndicators,
  type TechnicalIndicatorsResult,
} from "@/lib/market-indicators";
import { getRealSpxPriceSnapshot } from "@/lib/trading/spxw-scanner-v3";
import { scanSpxwOpportunitiesV3 } from "@/lib/trading/spxw-scanner-v3";
import type { SpxPriceSnapshot } from "@/lib/trading/spx-price-freshness";
import { buildSpxwTriggerPlan } from "@/lib/trading/spxw-trigger-engine";
import { getTradierQuotes } from "@/lib/trading/tradier-client";
import {
  fetchEconomicCalendarForGate,
} from "@/lib/trading/fahd-decision/fahd-economic-gate-integration";
import { evaluateEconomicGate } from "@/lib/trading/fahd-decision/economic-calendar-gate";
import { evaluateExplosionEngine } from "./engine";
import {
  contractPassedScannerLiquidity,
  mapEconomicDataStatus,
  selectExplosionContract,
} from "./integration";
import {
  buildOptionQuoteSnapshot,
  mapOptionQuoteDataStatus,
} from "./option-quote-freshness";
import { buildExplosionComponents, mapIndicatorFreshness } from "./market-adapter";

export interface ExplosionDiagnosticDependencies {
  getIndicators(symbol: string, timeframe: string): Promise<TechnicalIndicatorsResult>;
  getSpxSnapshot(): Promise<SpxPriceSnapshot>;
}

const DEFAULT_DEPENDENCIES: ExplosionDiagnosticDependencies = {
  getIndicators: async (symbol, timeframe) => {
    const result = await getTechnicalIndicators(symbol, timeframe);
    if ("error" in result) {
      throw new Error(`${symbol} ${timeframe}: ${result.error}`);
    }
    return result;
  },
  getSpxSnapshot: getRealSpxPriceSnapshot,
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchEconomicCalendar() {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  if (!apiKey) {
    return { events: [], dataStatus: "UNAVAILABLE" as const, fetchedAt: new Date().toISOString() };
  }
  return fetchEconomicCalendarForGate(apiKey, {
    fetchWithTimeout: (url, options, timeoutMs) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }),
    formatDate,
    finnhubBase: "https://finnhub.io/api/v1",
  });
}

export async function buildExplosionDiagnostic(
  dependencies: ExplosionDiagnosticDependencies = DEFAULT_DEPENDENCIES,
) {
  // Twelve Data does not consistently expose the cash SPX index on every plan.
  // Use SPY only as an explicitly disclosed technical/volume proxy while the
  // actual underlying price remains the real SPX quote from Tradier.
  const [spyFiveMinute, spyFifteenMinute, spxPrice] =
    await Promise.all([
      dependencies.getIndicators("SPY", "5min"),
      dependencies.getIndicators("SPY", "15min"),
      dependencies.getSpxSnapshot(),
    ]);

  const candle = {
    symbol: "SPY" as const,
    timeframe: "5min" as const,
    startTime:
      spyFiveMinute.dataStatus.candleTimeUtc ??
      spyFiveMinute.dataStatus.candleTime,
    isClosed: true as const,
    source: spyFiveMinute.dataStatus.source,
  };

  const components = buildExplosionComponents({
    spxFiveMinute: spyFiveMinute,
    spxFifteenMinute: spyFifteenMinute,
    spyFiveMinute,
  });
  const indicatorFreshness = mapIndicatorFreshness([
    spyFiveMinute,
    spyFifteenMinute,
  ]);
  const underlyingDataStatus =
    spxPrice.freshness === "live" && spxPrice.priceSource !== "close"
      ? indicatorFreshness
      : spxPrice.freshness === "unknown"
        ? "MISSING" as const
        : "STALE" as const;

  const engine = evaluateExplosionEngine({
    components,
    preExecution: {
      now: new Date().toISOString(),
      candle: { openTime: candle.startTime, closed: true },
      touchSnapshot: null,
      requiredDataMissing: false,
      invalidationHit: false,
      triggerTouched: false,
      candleClosedBeyondTrigger: false,
      entryNotExtended: true,
      breakoutAttemptWasValid: false,
    },
    contractQuality: null,
    breakoutVolumeConfirmed: false,
    underlyingDataStatus,
    contractDataStatus: "MISSING",
    contractLiquid: false,
    economicCalendarStatus: "UNAVAILABLE",
    economicGateAllowsEntry: false,
    executableTrigger: null,
    invalidationLevel: null,
    setupId: null,
  });

  const [scanResult, calendarResult] = await Promise.allSettled([
    scanSpxwOpportunitiesV3({
      analysisMode: "PREMARKET_PREP",
      maxResults: 2,
    }),
    fetchEconomicCalendar(),
  ]);

  const scan = scanResult.status === "fulfilled" ? scanResult.value : null;
  const economicCalendar =
    calendarResult.status === "fulfilled"
      ? calendarResult.value
      : { events: [], dataStatus: "UNAVAILABLE" as const, fetchedAt: new Date().toISOString() };
  const economicGate = evaluateEconomicGate(economicCalendar.events, Date.now(), {
    dataStatus: economicCalendar.dataStatus,
    hasOpenPosition: false,
  });
  const selectedContract = selectExplosionContract(
    engine.direction,
    scan?.opportunities ?? [],
  );
  let selectedContractQuote = null;
  let contractQuoteError: string | null = null;
  if (selectedContract) {
    try {
      const quotes = await getTradierQuotes([selectedContract.contractSymbol]);
      const quote = quotes.find(
        (item) =>
          item.symbol.trim().toUpperCase() ===
          selectedContract.contractSymbol.trim().toUpperCase(),
      );
      selectedContractQuote = quote ? buildOptionQuoteSnapshot(quote) : null;
      if (!selectedContractQuote) contractQuoteError = "OPTION_QUOTE_INVALID_OR_MISSING";
    } catch (error) {
      contractQuoteError =
        error instanceof Error ? error.message : "OPTION_QUOTE_FETCH_FAILED";
    }
  }
  const contractLiquid =
    contractPassedScannerLiquidity(selectedContract) &&
    selectedContractQuote !== null;
  const contractDataStatus = mapOptionQuoteDataStatus(selectedContractQuote);

  let triggerPlan: Awaited<ReturnType<typeof buildSpxwTriggerPlan>> | null = null;
  let triggerError: string | null = null;
  if (scan) {
    try {
      triggerPlan = await buildSpxwTriggerPlan({ precomputedScan: scan, maxResults: 2 });
    } catch (error) {
      triggerError = error instanceof Error ? error.message : "TRIGGER_PLAN_FAILED";
    }
  }

  const integratedEngine = evaluateExplosionEngine({
    components,
    preExecution: {
      now: new Date().toISOString(),
      candle: { openTime: candle.startTime, closed: true },
      touchSnapshot: null,
      requiredDataMissing: false,
      invalidationHit: false,
      triggerTouched: false,
      candleClosedBeyondTrigger: false,
      entryNotExtended: true,
      breakoutAttemptWasValid: false,
    },
    contractQuality: selectedContract?.contractScore ?? null,
    breakoutVolumeConfirmed: false,
    underlyingDataStatus,
    contractDataStatus,
    contractLiquid,
    economicCalendarStatus: mapEconomicDataStatus(economicGate.dataStatus),
    economicGateAllowsEntry: !economicGate.blockNewTrades,
    executableTrigger: null,
    invalidationLevel: null,
    setupId: null,
  });

  return {
    mode: "DIAGNOSTIC_ONLY" as const,
    warning: "هذه قراءة للأصل فقط؛ لا تتضمن عقد SPXW أو التقويم الاقتصادي ولا تصلح للدخول.",
    isExecutable: false as const,
    executableTrigger: null,
    technicalProxy: {
      symbol: "SPY" as const,
      purpose: "SPX_TECHNICAL_AND_VOLUME_PROXY" as const,
      timeframes: ["5min", "15min"] as const,
    },
    spxPrice,
    candle,
    engine: {
      ...integratedEngine,
      isExecutable: false as const,
      executableTrigger: null,
    },
    integration: {
      scanStatus: scan?.status ?? "DATA_PROVIDER_ERROR",
      scanError:
        scanResult.status === "rejected"
          ? scanResult.reason instanceof Error
            ? scanResult.reason.message
            : "SPXW_SCAN_FAILED"
          : null,
      selectedContract,
      contractQualitySource: selectedContract ? "optionBrain.contractScore" : null,
      selectedContractQuote,
      contractQuoteFreshness: contractDataStatus,
      contractQuoteError,
      contractFreshnessWarning:
        contractDataStatus === "FRESH"
          ? null
          : "Quote العقد غير لحظي أو يفتقد توقيتي bid/ask؛ التنفيذ مغلق.",
      economicGate,
      triggerPlan,
      triggerError,
    },
  };
}
