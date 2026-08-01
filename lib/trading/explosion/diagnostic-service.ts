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
  const [spxFiveMinute, spxFifteenMinute, spyFiveMinute, spxPrice, candle] =
    await Promise.all([
      dependencies.getIndicators("SPX", "5min"),
      dependencies.getIndicators("SPX", "15min"),
      dependencies.getIndicators("SPY", "5min"),
      dependencies.getSpxSnapshot(),
      dependencies.getLatestCandle("SPX"),
    ]);

  const components = buildExplosionComponents({
    spxFiveMinute,
    spxFifteenMinute,
    spyFiveMinute,
  });
  const indicatorFreshness = mapIndicatorFreshness([
    spxFiveMinute,
    spxFifteenMinute,
    spyFiveMinute,
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
    spxPrice,
    candle,
    engine: { ...engine, isExecutable: false as const, executableTrigger: null },
  };
}
