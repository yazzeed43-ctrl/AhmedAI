import { getMarketDecision } from "@/lib/market-decision-engine";
import { scanSpxwOpportunitiesV3 } from "./spxw-scanner-v3";
import { scanTradierOpportunities } from "./tradier-scanner";
import { rankPremarketDirections } from "./premarket-universe-ranking";
import { FAHD_STRATEGY } from "./scanner-strategies";

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

export async function scanUnifiedPremarketUniverse(config: {
  symbols?: string[];
  maxDte?: number;
  expirationsPerSymbol?: number;
  resultsPerDirection?: number;
} = {}) {
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

  const market = await getMarketDecision("15min");
  const stockScan = await scanTradierOpportunities({
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

  const spxwScan = await scanSpxwOpportunitiesV3({
    analysisMode: "PREMARKET_PREP",
    maxDte: Math.min(10, maxDte),
    maxResults: resultsPerDirection,
  });
  const spxwOpportunities = Array.isArray(spxwScan.opportunities)
    ? spxwScan.opportunities
    : [];
  const mayPublishStocks =
    stockScan.status === "OPPORTUNITIES_FOUND" ||
    stockScan.status === "NO_MATCH";
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
      status:
        stockScan.status === "OPPORTUNITIES_FOUND"
          ? ("WATCHLIST_READY" as const)
          : stockScan.status,
      symbolsRequested: stockScan.symbolsRequested,
      symbolsSucceeded: stockScan.symbolsSucceeded,
      symbolsFailed: stockScan.symbolsFailed,
      expirationsRequested: stockScan.expirationsRequested,
      expirationsSucceeded: stockScan.expirationsSucceeded,
      expirationsFailed: stockScan.expirationsFailed,
      providerErrors: stockScan.providerErrors,
      contractsScanned: stockScan.contractsScanned,
      qualifiedContracts: stockScan.qualifiedContracts,
      callWatchlist: mayPublishStocks ? stocks.calls : [],
      putWatchlist: mayPublishStocks ? stocks.puts : [],
      diagnosticOpportunities:
        stockScan.status === "PARTIAL_DATA"
          ? [...stocks.calls, ...stocks.puts]
          : [],
    },
    spxwScan: {
      status: spxwScan.status,
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
    `حالة بيانات الأسهم: ${result.stockScan.status}`,
    `الرموز: طلب ${result.stockScan.symbolsRequested} | نجح ${result.stockScan.symbolsSucceeded} | فشل ${result.stockScan.symbolsFailed}`,
    `الاستحقاقات: طلب ${result.stockScan.expirationsRequested} | نجح ${result.stockScan.expirationsSucceeded} | فشل ${result.stockScan.expirationsFailed}`,
    `حالة SPXW: ${result.spxwScan.status}`,
    `SPXW الاستحقاقات: طلب ${result.spxwScan.expirationsRequested} | نجح ${result.spxwScan.expirationsSucceeded} | فشل ${result.spxwScan.expirationsFailed}`,
    `SPXW العقود المفحوصة: ${result.spxwScan.contractsScanned}`,
    "isExecutable: false | executableTrigger: null",
  ];
  const addList = <T extends {
    rank?: number;
    contractSymbol?: string;
    strike?: number;
    expiration?: string;
    midpoint?: number;
    finalScore?: number;
    freshness?: string;
    priceSource?: string;
  }>(title: string, values: T[]) => {
    lines.push("", title);
    if (!values.length) {
      lines.push("- لا توجد عقود منشورة.");
      return;
    }
    for (const item of values) {
      lines.push(
        `- ${String(item.rank ?? "-")}. ${String(item.contractSymbol ?? "-")} | Strike ${String(item.strike ?? "-")} | Exp ${String(item.expiration ?? "-")} | Mid ${String(item.midpoint ?? "-")} | Score ${String(item.finalScore ?? "-")} | freshness ${String(item.freshness ?? "unknown")} | priceSource ${String(item.priceSource ?? "unknown")}`,
      );
    }
  };
  addList("SPXW CALL", result.spxwScan.callWatchlist);
  addList("SPXW PUT", result.spxwScan.putWatchlist);
  addList("Stocks/ETF CALL", result.stockScan.callWatchlist);
  addList("Stocks/ETF PUT", result.stockScan.putWatchlist);
  if (result.stockScan.status === "PARTIAL_DATA") {
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
      `تحذيرات المزود: ${result.stockScan.providerErrors.map((error) => `${error.symbol}:${error.code}`).join("، ")}`,
    );
  }
  if (result.spxwScan.providerErrors.length) {
    lines.push(
      "",
      `تحذيرات مزود SPXW: ${result.spxwScan.providerErrors.map((error) => `${error.expiration}:${error.code}`).join("، ")}`,
    );
  }
  lines.push(
    "",
    "هذه القائمة ليست دخولًا. أعد الفحص بعد الافتتاح بسعر حي وإغلاق شمعة 5 دقائق مؤكدة.",
  );
  return lines.join("\n");
}
