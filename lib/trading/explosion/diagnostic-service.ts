import {
  getLatestCompletedFiveMinuteCandle,
  getTechnicalIndicators,
  type LatestCompletedCandle,
  type TechnicalIndicatorsResult,
} from "@/lib/market-indicators";
import { getRealSpxPriceSnapshot } from "@/lib/trading/spxw-scanner-v3";
import type { SpxPriceSnapshot } from "@/lib/trading/spx-price-freshness";
import { evaluateExplosionEngine } from "./engine";
import { buildExplosionComponents, mapIndicatorFreshness } from "./market-adapter";

export interface ExplosionDiagnosticDependencies {
  getIndicators(symbol: string, timeframe: string): Promise<TechnicalIndicatorsResult>;
  getSpxSnapshot(): Promise<SpxPriceSnapshot>;
  getLatestCandle(symbol: string): Promise<LatestCompletedCandle>;
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
  getLatestCandle: getLatestCompletedFiveMinuteCandle,
};

export async function buildExplosionDiagnostic(
  dependencies: ExplosionDiagnosticDependencies = DEFAULT_DEPENDENCIES,
) {
  // Twelve Data does not consistently expose the cash SPX index on every plan.
  // Use SPY only as an explicitly disclosed technical/volume proxy while the
  // actual underlying price remains the real SPX quote from Tradier.
  const [spyFiveMinute, spyFifteenMinute, spxPrice, candle] =
    await Promise.all([
      dependencies.getIndicators("SPY", "5min"),
      dependencies.getIndicators("SPY", "15min"),
      dependencies.getSpxSnapshot(),
      dependencies.getLatestCandle("SPY"),
    ]);

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
    engine: { ...engine, isExecutable: false as const, executableTrigger: null },
  };
}
