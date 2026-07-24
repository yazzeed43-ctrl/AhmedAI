import { runScannerWithStrategy } from "./run-scanner-with-strategy";
import { GOLDEN_STRATEGY, type ScannerStrategy } from "./scanner-strategies";
import type {
  TradierOpportunity,
  TradierScannerConfig,
} from "./tradier-scanner";

type MarketBias = "CALL_BIAS" | "PUT_BIAS" | "WAIT";

export interface GoldenScannerConfig extends TradierScannerConfig {
  timeframe?: "15min" | "1h" | "1day";
  minimumFinalScore?: number;
}

export interface GoldenOpportunity extends TradierOpportunity {
  marketBias: MarketBias;
  marketScore: number;
  finalScore: number;
  status: "WAIT_TRIGGER";
}

function resolveGoldenStrategy(config: GoldenScannerConfig): ScannerStrategy {
  return {
    ...GOLDEN_STRATEGY,
    timeframe: config.timeframe ?? GOLDEN_STRATEGY.timeframe,
    minimumFinalScore:
      config.minimumFinalScore ?? GOLDEN_STRATEGY.minimumFinalScore,
    maxResults: GOLDEN_STRATEGY.maxResults,
    contractDefaults: {
      minPrice: config.minPrice ?? GOLDEN_STRATEGY.contractDefaults.minPrice,
      maxPrice: config.maxPrice ?? GOLDEN_STRATEGY.contractDefaults.maxPrice,
      minDelta: config.minDelta ?? GOLDEN_STRATEGY.contractDefaults.minDelta,
      maxDelta: config.maxDelta ?? GOLDEN_STRATEGY.contractDefaults.maxDelta,
      minVolume: config.minVolume ?? GOLDEN_STRATEGY.contractDefaults.minVolume,
      minOpenInterest:
        config.minOpenInterest ??
        GOLDEN_STRATEGY.contractDefaults.minOpenInterest,
      maxSpreadPercent:
        config.maxSpreadPercent ??
        GOLDEN_STRATEGY.contractDefaults.maxSpreadPercent,
    },
  };
}

// golden-scanner.ts القديم كان ينتج status بقيمة "WAIT_TRIGGER" فقط
// دايمًا (ما فيه منطق حالي ينتج READY أو REJECTED). لو هذا تغيّر
// مستقبلاً (راجع ExecutionStatus بـ scanner-strategies.ts)، هذا
// الفحص يفشل بوضوح بدل ما يمرر قيمة غلط بصمت لحقل تاريخي محصور.
function assertWaitTrigger(status: string): asserts status is "WAIT_TRIGGER" {
  if (status !== "WAIT_TRIGGER") {
    throw new Error(
      `Golden scanner received unsupported execution status: ${status}`,
    );
  }
}

export async function scanGoldenOpportunities(config: GoldenScannerConfig) {
  const strategy = resolveGoldenStrategy(config);

  const requestedResults = Math.min(5, Math.max(1, config.results ?? 3));

  const result = await runScannerWithStrategy(strategy, {
    symbols: config.symbols,
    maxDte: config.maxDte,
    expirationsPerSymbol: config.expirationsPerSymbol,
    requestedResults,
  });

  const opportunities: GoldenOpportunity[] = result.opportunities.map(
    (item) => {
      const { executionStatus, ...rest } = item;
      assertWaitTrigger(executionStatus);
      return {
        ...rest,
        status: executionStatus,
      };
    },
  );

  return {
    generatedAt: result.generatedAt,
    status: result.status,
    market: result.market,
    // تبقى موجودة دايمًا. بحالة WAIT تصير 0/0 لأن المحرك ما يعد
    // يجلب عقود Tradier قبل وضوح السوق (تحسين متفق عليه).
    contractsScanned: result.contractsScanned,
    qualifiedContracts: result.qualifiedContracts,
    opportunities,
    message: result.message,
  };
}
