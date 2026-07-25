import { scanSpxwOpportunitiesV3 } from "./spxw-scanner-v3";

export interface SpxwScannerConfig {
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

export async function scanSpxwOpportunities(config: SpxwScannerConfig = {}) {
  const maxDte = Math.max(0, Math.floor(config.maxDte ?? 2));

  const maxResults = Math.max(1, Math.min(2, config.maxResults ?? 2));

  const result = await scanSpxwOpportunitiesV3({
    maxDte,
    maxResults,
    minimumFinalScore: config.minimumFinalScore ?? 72,
    minPrice: config.minPrice ?? 0.5,
    maxPrice: config.maxPrice ?? 20,
    minVolume: config.minVolume ?? 50,
    minOpenInterest: config.minOpenInterest ?? 100,
    maxSpreadPercent: config.maxSpreadPercent ?? 12,
    minDelta: config.minDelta ?? 0.45,
    maxDelta: config.maxDelta ?? 0.7,
  });

  if (
    result.status === "WAIT" ||
    result.status === "DATA_PROVIDER_ERROR" ||
    result.status === "PARTIAL_DATA"
  ) {
    return {
      ...result,
      source: "Tradier SPX/SPXW option chains via SPXW Scanner V3",
    };
  }

  const opportunities = result.opportunities
    .slice(0, maxResults)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

  return {
    generatedAt: result.generatedAt,
    status: result.status,
    source: "Tradier SPX/SPXW option chains via SPXW Scanner V3",
    market: result.market,
    underlyingPrice: result.underlyingPrice,
    tradeDate: result.tradeDate,
    ageSeconds: result.ageSeconds,
    freshness: result.freshness,
    underlyingQuote: result.underlyingQuote,
    expirationsScanned: result.expirationsScanned ?? [],
    expirationsRequested: result.expirationsRequested,
    expirationsSucceeded: result.expirationsSucceeded,
    expirationsFailed: result.expirationsFailed,
    providerErrors: result.providerErrors,
    contractsScanned: result.contractsScanned,
    spxwContractsFound: result.spxwContractsFound,
    opportunities,
    message:
      opportunities.length > 0
        ? `وجد فهد ${opportunities.length} فرصة SPXW متوافقة مع السوق.`
        : "لا يوجد عقد SPXW يحقق الشروط الآن.",
  };
}
