import { runScannerWithStrategy } from "./run-scanner-with-strategy";
import { FAHD_STRATEGY, type ScannerStrategy } from "./scanner-strategies";
import type { TradierScannerConfig } from "./tradier-scanner";

// نفس شكل الطلب التاريخي بالضبط — كل حقل هنا اختياري وقابل
// للـ override من المتصل، تمامًا زي fahd-scanner-v3.ts القديم.
export interface FahdScannerV3Config extends TradierScannerConfig {
  timeframe?: "15min" | "1h" | "1day";
  minimumFinalScore?: number;
  maxResults?: number;
}

// يبني نسخة من FAHD_STRATEGY مع override أي قيمة مررها المتصل
// صراحة. لو ما مرر شي، تُستخدم افتراضيات FAHD_STRATEGY كما هي —
// نفس سلوك `config.X ?? defaultValue` القديم بالضبط.
function resolveFahdStrategy(config: FahdScannerV3Config): ScannerStrategy {
  return {
    ...FAHD_STRATEGY,
    timeframe: config.timeframe ?? FAHD_STRATEGY.timeframe,
    minimumFinalScore:
      config.minimumFinalScore ?? FAHD_STRATEGY.minimumFinalScore,
    maxResults: FAHD_STRATEGY.maxResults, // سقف 2 دايمًا، زي القديم (Math.min(2, ...))
    contractDefaults: {
      minPrice: config.minPrice ?? FAHD_STRATEGY.contractDefaults.minPrice,
      maxPrice: config.maxPrice ?? FAHD_STRATEGY.contractDefaults.maxPrice,
      minDelta: config.minDelta ?? FAHD_STRATEGY.contractDefaults.minDelta,
      maxDelta: config.maxDelta ?? FAHD_STRATEGY.contractDefaults.maxDelta,
      minVolume: config.minVolume ?? FAHD_STRATEGY.contractDefaults.minVolume,
      minOpenInterest:
        config.minOpenInterest ??
        FAHD_STRATEGY.contractDefaults.minOpenInterest,
      maxSpreadPercent:
        config.maxSpreadPercent ??
        FAHD_STRATEGY.contractDefaults.maxSpreadPercent,
    },
  };
}

// fahd-scanner-v3.ts القديم كان ينتج triggerStatus بقيمة
// "WAIT_TRIGGER" فقط دايمًا. لو ExecutionStatus أنتج READY أو
// REJECTED مستقبلاً، هذا يفشل بوضوح بدل ما يمرر قيمة غلط بصمت
// (نفس الحماية المطبّقة بـ golden-scanner.ts).
function assertWaitTrigger(status: string): asserts status is "WAIT_TRIGGER" {
  if (status !== "WAIT_TRIGGER") {
    throw new Error(
      `Fahd scanner received unsupported execution status: ${status}`,
    );
  }
}

export async function runFahdScannerV3(config: FahdScannerV3Config) {
  const strategy = resolveFahdStrategy(config);

  const result = await runScannerWithStrategy(strategy, {
    symbols: config.symbols,
    maxDte: config.maxDte,
    expirationsPerSymbol: config.expirationsPerSymbol,
    // القديم كان يقص لحد أقصى 2 بغض النظر عن config.maxResults
    // (Math.max(1, Math.min(2, config.maxResults ?? 2))) — نفس
    // النتيجة محفوظة تلقائيًا لأن strategy.maxResults مقفول على 2.
    requestedResults: config.maxResults,
  });

  // تحويل الحقل الموحد (executionStatus) لاسمه التاريخي (triggerStatus)
  // حفاظًا على شكل الإخراج بالضبط لكل مستهلك حالي
  // (fahd-recommendations, golden-opportunities-v3).
  const opportunities = result.opportunities.map((item) => {
    const { executionStatus, ...rest } = item;
    assertWaitTrigger(executionStatus);
    return { ...rest, triggerStatus: executionStatus };
  });

  if (result.status === "WAIT") {
    return {
      generatedAt: result.generatedAt,
      status: result.status,
      market: result.market,
      opportunities: [] as typeof opportunities,
      message: result.message,
    };
  }

  return {
    generatedAt: result.generatedAt,
    status: result.status,
    market: result.market,
    contractsScanned: result.contractsScanned,
    qualifiedContracts: result.qualifiedContracts,
    opportunities,
    message: result.message,
  };
}
