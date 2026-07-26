import type { EconomicGateDecision } from "./economic-calendar-gate";

export type AnalysisMode = "PREMARKET_PREP" | "LIVE_EXECUTION";

export type PreparationStatus =
  | "WATCHLIST_READY"
  | "NO_MATCH"
  | "DATA_PROVIDER_ERROR"
  | "PARTIAL_DATA";

export type ReferenceLevels = {
  referenceUnderlyingPrice: number;
  activationReference: number;
  invalidationReference: number;
  target1Reference: number;
  target2Reference: number;
};

type OpportunityLike = {
  contractSymbol: string;
  direction: "CALL" | "PUT";
  strike: number;
  expiration: string;
  midpoint: number;
  finalScore: number;
  [key: string]: unknown;
};

type ScanLike = {
  status: string;
  underlyingPrice?: number;
  underlyingQuote?: unknown;
  opportunities?: OpportunityLike[];
  contractsScanned?: number;
  spxwContractsFound?: number;
  filterCriteria?: unknown;
  rejectionReasons?: string[];
  [key: string]: unknown;
};

export type PremarketWatchlistResult = {
  mode: "PREMARKET_PREP";
  preparationStatus: PreparationStatus;
  watchlist: Array<{
    direction: "CALL" | "PUT";
    contractSymbol: string;
    strike: number;
    expiration: string;
    midpoint: number;
    finalScore: number;
    referenceLevels: ReferenceLevels;
  }>;
  referenceLevels: ReferenceLevels[];
  diagnosticOpportunities: OpportunityLike[];
  dataFreshness: "PREPARATION_ONLY";
  isExecutable: false;
  executableTrigger: null;
  warnings: string[];
  scanDiagnostics: {
    scanStatus: string;
    contractsScanned: number;
    spxwContractsFound: number;
    filterCriteria: unknown;
    rejectionReasons: string[];
  };
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildReferenceLevels(
  direction: "CALL" | "PUT",
  referenceUnderlyingPrice: number,
): ReferenceLevels {
  const activationReference =
    direction === "CALL"
      ? referenceUnderlyingPrice + 1.5
      : referenceUnderlyingPrice - 1.5;
  const invalidationReference =
    direction === "CALL"
      ? activationReference - 6
      : activationReference + 6;
  const target1Reference =
    direction === "CALL"
      ? activationReference + 8
      : activationReference - 8;
  const target2Reference =
    direction === "CALL"
      ? activationReference + 15
      : activationReference - 15;

  return {
    referenceUnderlyingPrice: round(referenceUnderlyingPrice),
    activationReference: round(activationReference),
    invalidationReference: round(invalidationReference),
    target1Reference: round(target1Reference),
    target2Reference: round(target2Reference),
  };
}

function preparationStatusFor(scanStatus: string): PreparationStatus {
  if (scanStatus === "OPPORTUNITIES_FOUND") return "WATCHLIST_READY";
  if (scanStatus === "NO_MATCH") return "NO_MATCH";
  if (scanStatus === "PARTIAL_DATA") return "PARTIAL_DATA";
  return "DATA_PROVIDER_ERROR";
}

export function buildSpxwPremarketWatchlist(input: {
  scan: ScanLike;
  economicGate: EconomicGateDecision;
}): PremarketWatchlistResult {
  const { scan, economicGate } = input;
  const preparationStatus = preparationStatusFor(scan.status);
  const opportunities = Array.isArray(scan.opportunities)
    ? scan.opportunities
    : [];
  const referenceUnderlyingPrice = scan.underlyingPrice;
  const mayPublishWatchlist =
    preparationStatus === "WATCHLIST_READY" &&
    typeof referenceUnderlyingPrice === "number" &&
    Number.isFinite(referenceUnderlyingPrice);

  const watchlist = mayPublishWatchlist
    ? opportunities.map((opportunity) => ({
        direction: opportunity.direction,
        contractSymbol: opportunity.contractSymbol,
        strike: opportunity.strike,
        expiration: opportunity.expiration,
        midpoint: opportunity.midpoint,
        finalScore: opportunity.finalScore,
        referenceLevels: buildReferenceLevels(
          opportunity.direction,
          referenceUnderlyingPrice,
        ),
      }))
    : [];

  const warnings = [
    "هذه قائمة تحضير فقط وليست توصية دخول. أعد الفحص بعد افتتاح السوق بسعر SPX حي وإغلاق شمعة 5 دقائق مؤكدة.",
  ];
  if (economicGate.dataStatus !== "AVAILABLE") {
    warnings.push(
      "تعذر التحقق الكامل من التقويم الاقتصادي؛ أعد الفحص قبل التنفيذ.",
    );
  }
  if (preparationStatus === "PARTIAL_DATA") {
    warnings.push(
      "المسح جزئي؛ الفرص المكتشفة محفوظة للتشخيص فقط ولم تُنشر في قائمة المراقبة.",
    );
  }
  if (preparationStatus === "DATA_PROVIDER_ERROR") {
    warnings.push("تعذر إكمال مسح SPXW؛ لم تُبنَ قائمة مراقبة.");
  }

  return {
    mode: "PREMARKET_PREP",
    preparationStatus,
    watchlist,
    referenceLevels: watchlist.map((item) => item.referenceLevels),
    diagnosticOpportunities:
      preparationStatus === "PARTIAL_DATA" ? opportunities : [],
    dataFreshness: "PREPARATION_ONLY",
    isExecutable: false,
    executableTrigger: null,
    warnings,
    scanDiagnostics: {
      scanStatus: scan.status,
      contractsScanned: scan.contractsScanned ?? 0,
      spxwContractsFound: scan.spxwContractsFound ?? 0,
      filterCriteria: scan.filterCriteria ?? null,
      rejectionReasons: Array.isArray(scan.rejectionReasons)
        ? scan.rejectionReasons
        : [],
    },
  };
}

export function formatSpxwPremarketWatchlist(input: {
  preparation: PremarketWatchlistResult;
  scan: ScanLike;
  economicGate: EconomicGateDecision;
}): string {
  const { preparation, scan, economicGate } = input;
  const quote = (scan.underlyingQuote ?? {}) as {
    priceSource?: string;
    freshness?: string;
    tradeDate?: string | null;
    ageSeconds?: number | null;
  };
  const lines = [
    "قائمة مراقبة SPXW — تحضير فقط، وليست دخولًا مؤكدًا.",
    `وضع التحليل: ${preparation.mode}`,
    `حالة التحضير: ${preparation.preparationStatus}`,
    `حالة المسح: ${preparation.scanDiagnostics.scanStatus}`,
    `العقود المفحوصة: ${preparation.scanDiagnostics.contractsScanned}`,
    `حداثة البيانات: ${preparation.dataFreshness}`,
    `سعر SPX المرجعي: ${String(scan.underlyingPrice ?? "غير متاح")}`,
    `مزود السعر: Tradier | priceSource: ${quote.priceSource ?? "unknown"} | freshness: ${quote.freshness ?? "unknown"} | ageSeconds: ${quote.ageSeconds ?? "unknown"} | tradeDate: ${quote.tradeDate ?? "unknown"}`,
    `التقويم الاقتصادي: ${economicGate.dataStatus} | blockNewTrades: ${economicGate.blockNewTrades} | blockCause: ${economicGate.blockCause}`,
    "الأخبار: لم تُستخدم لاعتماد دخول في وضع التحضير؛ يجب إعادة فحصها قبل التنفيذ.",
  ];

  if (preparation.watchlist.length) {
    lines.push("", "العقود التي اجتازت فلاتر فهد الحالية:");
    for (const item of preparation.watchlist) {
      const levels = item.referenceLevels;
      lines.push(
        `- ${item.direction} | ${item.contractSymbol} | Strike ${item.strike} | Exp ${item.expiration} | Midpoint ${item.midpoint} | Score ${item.finalScore} | مراقبة ${levels.activationReference} | إبطال مرجعي ${levels.invalidationReference} | هدف1 ${levels.target1Reference} | هدف2 ${levels.target2Reference}`,
      );
    }
  } else {
    lines.push("", "لا توجد عقود منشورة في قائمة المراقبة.");
  }

  if (preparation.scanDiagnostics.rejectionReasons.length) {
    lines.push(
      `أسباب عدم التأهل: ${preparation.scanDiagnostics.rejectionReasons.join("؛ ")}`,
    );
  }
  lines.push("", ...preparation.warnings);
  return lines.join("\n");
}
