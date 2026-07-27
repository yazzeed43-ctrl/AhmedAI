import { rankPremarketDirections } from "./premarket-universe-ranking";
import { FAHD_STRATEGY } from "./scanner-strategies";

export interface UnifiedPremarketScannerDependencies {
  getMarketDecision: (timeframe: "15min") => Promise<any>;
  scanStocks: (
    config: Parameters<
      typeof import("./tradier-scanner").scanTradierOpportunities
    >[0],
  ) => Promise<any>;
  scanSpxw: (
    config: Parameters<
      typeof import("./spxw-scanner-v3").scanSpxwOpportunitiesV3
    >[0],
  ) => Promise<any>;
}

const defaultUnifiedPremarketScannerDependencies: UnifiedPremarketScannerDependencies = {
  getMarketDecision: async (timeframe) => {
    const module = await import("../market-decision-engine");
    return module.getMarketDecision(timeframe);
  },
  scanStocks: async (config) => {
    const module = await import("./tradier-scanner");
    return module.scanTradierOpportunities(config);
  },
  scanSpxw: async (config) => {
    const module = await import("./spxw-scanner-v3");
    return module.scanSpxwOpportunitiesV3(config);
  },
};

export const DEFAULT_PREMARKET_UNIVERSE = [
  "SPY",
  "QQQ",
  "IWM",
  "NVDA",
  "TSLA",
  "AAPL",
  "AMD",
  "META",
  "AMZN",
  "MSFT",
] as const;

export function isUnifiedPremarketPreparationRequest(message: string): boolean {
  const asksForPreparation =
    /PREMARKET_PREP|premarket|watchlist|قبل\s*السوق|قبل\s*الافتتاح|قائمة\s*(?:فهد\s*)?(?:الموحدة|موحدة)|تحضير(?:ية)?/i.test(
      message,
    );
  const asksForUnifiedUniverse =
    /unified|موحد(?:ة)?/i.test(message) ||
    (/\bSPXW?\b/i.test(message) &&
      /أسهم|السهم|ETF|ETFs|stocks?|universe/i.test(message));

  return asksForPreparation && asksForUnifiedUniverse;
}

export async function scanUnifiedPremarketUniverse(config: {
  symbols?: string[];
  maxDte?: number;
  expirationsPerSymbol?: number;
  resultsPerDirection?: number;
} = {}, dependencyOverrides: Partial<UnifiedPremarketScannerDependencies> = {}) {
  const dependencies = {
    ...defaultUnifiedPremarketScannerDependencies,
    ...dependencyOverrides,
  };
  const symbols = [
    ...new Set(
      (config.symbols ?? [...DEFAULT_PREMARKET_UNIVERSE])
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)),
    ),
  ].slice(0, 20);
  const maxDte = Math.max(1, Math.min(14, Math.floor(config.maxDte ?? 7)));
  const resultsPerDirection = Math.max(
    1,
    Math.min(5, Math.floor(config.resultsPerDirection ?? 2)),
  );

  const market = await dependencies.getMarketDecision("15min");
  const stockScan = await dependencies.scanStocks({
    symbols,
    maxDte,
    expirationsPerSymbol: config.expirationsPerSymbol ?? 3,
    results: 20,
    ...FAHD_STRATEGY.contractDefaults,
  });
  const stocks = rankPremarketDirections({
    opportunities: stockScan.opportunities,
    marketBias: market.bias,
    bullishProbability: market.probabilities.bullish,
    bearishProbability: market.probabilities.bearish,
    minimumFinalScore: FAHD_STRATEGY.minimumFinalScore,
    resultsPerDirection,
  });

  const spxwScan = await dependencies.scanSpxw({
    analysisMode: "PREMARKET_PREP",
    maxDte: Math.min(10, maxDte),
    maxResults: resultsPerDirection,
  });
  const spxwOpportunities = Array.isArray(spxwScan.opportunities)
    ? spxwScan.opportunities
    : [];
  const mayPublishStocks = stockScan.dataStatus === "COMPLETE";
  const mayPublishSpxw = spxwScan.status === "OPPORTUNITIES_FOUND";
  const rankDirection = <T extends { direction: "CALL" | "PUT" }>(
    values: T[],
    direction: "CALL" | "PUT",
  ) =>
    values
      .filter((item) => item.direction === direction)
      .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    sessionDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    generatedAt: new Date().toISOString(),
    analysisMode: "PREMARKET_PREP" as const,
    dataFreshness: "PREPARATION_ONLY" as const,
    marketBias: market.bias,
    universe: symbols,
    stockScan: {
      dataStatus: stockScan.dataStatus,
      outcome: stockScan.outcome,
      diagnostic: stockScan.diagnostic,
      symbolsRequested: stockScan.symbolsRequested,
      symbolsWithAnySuccess: stockScan.symbolsWithAnySuccess,
      symbolsFailedCompletely: stockScan.symbolsFailedCompletely,
      expirationsRequested: stockScan.expirationsRequested,
      expirationsSucceeded: stockScan.expirationsSucceeded,
      expirationsFailed: stockScan.expirationsFailed,
      providerErrors: stockScan.providerErrors,
      contractsScanned: stockScan.contractsScanned,
      qualifiedContracts: stockScan.qualifiedContracts,
      callWatchlist: mayPublishStocks ? stocks.calls : [],
      putWatchlist: mayPublishStocks ? stocks.puts : [],
      diagnosticOpportunities:
        stockScan.dataStatus === "PARTIAL_DATA"
          ? [...stocks.calls, ...stocks.puts]
          : [],
    },
    spxwScan: {
      status: spxwScan.status,
      underlyingQuote: spxwScan.underlyingQuote ?? null,
      contractsScanned: spxwScan.contractsScanned ?? 0,
      expirationsRequested: spxwScan.expirationsRequested ?? 0,
      expirationsSucceeded: spxwScan.expirationsSucceeded ?? 0,
      expirationsFailed: spxwScan.expirationsFailed ?? 0,
      providerErrors: spxwScan.providerErrors ?? [],
      callWatchlist: mayPublishSpxw
        ? rankDirection(spxwOpportunities, "CALL")
        : [],
      putWatchlist: mayPublishSpxw
        ? rankDirection(spxwOpportunities, "PUT")
        : [],
      diagnosticOpportunities:
        spxwScan.status === "PARTIAL_DATA" ? spxwOpportunities : [],
    },
    isExecutable: false as const,
    executableTrigger: null,
  };
}

export function formatUnifiedPremarketWatchlist(
  result: Awaited<ReturnType<typeof scanUnifiedPremarketUniverse>>,
): string {
  const lines = [
    "قائمة فهد الموحدة قبل السوق — تحضير ومراقبة فقط.",
    `تاريخ الجلسة: ${result.sessionDate}`,
    `انحياز السوق: ${result.marketBias}`,
    `حالة بيانات الأسهم: ${result.stockScan.dataStatus} | النتيجة: ${result.stockScan.outcome} | التشخيص: ${result.stockScan.diagnostic}`,
    `الرموز: طلب ${result.stockScan.symbolsRequested} | له نجاح واحد على الأقل ${result.stockScan.symbolsWithAnySuccess} | فشل بالكامل ${result.stockScan.symbolsFailedCompletely}`,
    `الاستحقاقات: طلب ${result.stockScan.expirationsRequested} | نجح ${result.stockScan.expirationsSucceeded} | فشل ${result.stockScan.expirationsFailed}`,
    `حالة SPXW: ${result.spxwScan.status}`,
    `SPXW الاستحقاقات: طلب ${result.spxwScan.expirationsRequested} | نجح ${result.spxwScan.expirationsSucceeded} | فشل ${result.spxwScan.expirationsFailed}`,
    `SPXW العقود المفحوصة: ${result.spxwScan.contractsScanned}`,
    "isExecutable: false | executableTrigger: null",
  ];

  const spxReference = result.spxwScan.underlyingQuote;
  lines.push(
    `SPX reference: price ${String(spxReference?.price ?? "غير متاح")} | freshness ${String(spxReference?.freshness ?? "unknown")} | priceSource ${String(spxReference?.priceSource ?? "unknown")} | ageSeconds ${String(spxReference?.ageSeconds ?? "unknown")} | tradeDate ${String(spxReference?.tradeDate ?? "unknown")}`,
  );

  const addList = <T extends {
    rank?: number;
    contractSymbol?: string;
    strike?: number;
    expiration?: string;
    midpoint?: number;
    finalScore?: number;
    freshness?: string;
    priceSource?: string;
  }>(
    title: string,
    values: T[],
    includeItemPriceProvenance = true,
  ) => {
    lines.push("", title);
    if (!values.length) {
      lines.push("- لا توجد عقود منشورة.");
      return;
    }
    for (const item of values) {
      const provenance = includeItemPriceProvenance
        ? ` | freshness ${String(item.freshness ?? "unknown")} | priceSource ${String(item.priceSource ?? "unknown")}`
        : "";
      lines.push(
        `- ${String(item.rank ?? "-")}. ${String(item.contractSymbol ?? "-")} | Strike ${String(item.strike ?? "-")} | Exp ${String(item.expiration ?? "-")} | Mid ${String(item.midpoint ?? "-")} | Score ${String(item.finalScore ?? "-")}${provenance}`,
      );
    }
  };
  addList("SPXW CALL", result.spxwScan.callWatchlist, false);
  addList("SPXW PUT", result.spxwScan.putWatchlist, false);
  addList("Stocks/ETF CALL", result.stockScan.callWatchlist);
  addList("Stocks/ETF PUT", result.stockScan.putWatchlist);
  if (result.stockScan.dataStatus === "PARTIAL_DATA") {
    lines.push(
      "",
      "هذه النتائج جزئية وغير صالحة كقائمة مراقبة موثوقة.",
    );
    addList(
      "فرص الأسهم الجزئية — للتشخيص فقط",
      result.stockScan.diagnosticOpportunities,
    );
  }
  if (result.spxwScan.status === "PARTIAL_DATA") {
    lines.push(
      "",
      "نتائج SPXW التالية جزئية وللتشخيص فقط، وليست قائمة مراقبة موثوقة.",
    );
    addList(
      "فرص SPXW الجزئية — للتشخيص فقط",
      result.spxwScan.diagnosticOpportunities,
    );
  }
  if (result.stockScan.providerErrors.length) {
    lines.push(
      "",
      `تحذيرات المزود: ${result.stockScan.providerErrors.map((error: { symbol: string; code: string }) => `${error.symbol}:${error.code}`).join("، ")}`,
    );
  }
  if (result.spxwScan.providerErrors.length) {
    lines.push(
      "",
      `تحذيرات مزود SPXW: ${result.spxwScan.providerErrors.map((error: { expiration: string; code: string }) => `${error.expiration}:${error.code}`).join("، ")}`,
    );
  }
  lines.push(
    "",
    "هذه القائمة ليست دخولًا. أعد الفحص بعد الافتتاح بسعر حي وإغلاق شمعة 5 دقائق مؤكدة.",
  );
  return lines.join("\n");
}
