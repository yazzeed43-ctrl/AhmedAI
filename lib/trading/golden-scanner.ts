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

/**
 * يبني استراتيجية Golden الفعلية بعد دمج
 * أي Overrides قادمة من المستدعي.
 *
 * القيم غير المرسلة ترجع إلى سلوك
 * Golden التاريخي وافتراضيات Tradier.
 */
function resolveGoldenStrategy(config: GoldenScannerConfig): ScannerStrategy {
  return {
    ...GOLDEN_STRATEGY,

    timeframe: config.timeframe ?? GOLDEN_STRATEGY.timeframe,

    minimumFinalScore:
      config.minimumFinalScore ?? GOLDEN_STRATEGY.minimumFinalScore,

    // يبقى سقف Golden خمس نتائج.
    // العدد المطلوب الفعلي يُمرر لاحقًا
    // إلى requestedResults.
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

/**
 * Wrapper متوافق خلفيًا مع Golden Scanner القديم.
 *
 * المنطق الأساسي أصبح في runScannerWithStrategy،
 * بينما هذا الملف مسؤول عن:
 *
 * 1. دمج Overrides القديمة.
 * 2. الحفاظ على عدد النتائج الافتراضي 3.
 * 3. الحفاظ على سقف النتائج 5.
 * 4. تحويل executionStatus إلى status.
 * 5. الحفاظ على شكل الإخراج التاريخي.
 */
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

    // تبقى الحقول موجودة دائمًا.
    // في حالة WAIT تصبح صفرًا لأن المحرك
    // لم يعد يجلب عقود Tradier قبل وضوح السوق.
    contractsScanned: result.contractsScanned,

    qualifiedContracts: result.qualifiedContracts,

    opportunities,

    message: result.message,
  };
}
