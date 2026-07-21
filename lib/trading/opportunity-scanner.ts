import {
  runTradeEngine,
  type TradeEngineInput,
  type TradeEngineReport,
} from "./trade-engine";

export interface OpportunityScannerConfig {
  limit?: number;
  minimumTradeScore?: number;
  minimumOptionScore?: number;
  minimumConfidence?: number;
  includeWatchlist?: boolean;
}

export interface ScannedOpportunity {
  rank: number;
  tier: "GOLD" | "STRONG" | "WATCH";
  symbol: string;
  contract: TradeEngineReport["contract"];
  decision: TradeEngineReport["decision"];
  confidence: number;
  scores: TradeEngineReport["scores"];
  optionQuality: TradeEngineReport["optionQuality"];
  trigger: TradeEngineReport["trigger"];
  alignment: boolean;
  reasons: string[];
  warnings: string[];
  summary: string;
}

export interface OpportunityScannerResult {
  scanned: number;
  qualified: number;
  rejected: number;
  opportunities: ScannedOpportunity[];
  message: string;
}

const DEFAULT_CONFIG: Required<OpportunityScannerConfig> = {
  limit: 5,
  minimumTradeScore: 72,
  minimumOptionScore: 60,
  minimumConfidence: 65,
  includeWatchlist: true,
};

function getTier(report: TradeEngineReport): ScannedOpportunity["tier"] {
  if (
    report.scores.trade >= 85 &&
    report.scores.options >= 75 &&
    report.confidence >= 80 &&
    report.alignment &&
    report.trigger === "CONFIRMED" &&
    (report.decision === "BUY_CALL" || report.decision === "BUY_PUT")
  ) {
    return "GOLD";
  }

  if (
    report.scores.trade >= 75 &&
    report.scores.options >= 65 &&
    report.confidence >= 70 &&
    report.alignment &&
    report.trigger === "CONFIRMED"
  ) {
    return "STRONG";
  }

  return "WATCH";
}

function calculateRankingScore(report: TradeEngineReport): number {
  const decisionBonus =
    report.decision === "BUY_CALL" || report.decision === "BUY_PUT" ? 8 : 0;
  const triggerBonus = report.trigger === "CONFIRMED" ? 6 : 0;
  const alignmentBonus = report.alignment ? 6 : 0;
  const warningPenalty = Math.min(10, report.warnings.length * 2);

  return (
    report.scores.trade * 0.42 +
    report.scores.options * 0.28 +
    report.confidence * 0.3 +
    decisionBonus +
    triggerBonus +
    alignmentBonus -
    warningPenalty
  );
}

export function scanOptionOpportunities(
  candidates: TradeEngineInput[],
  config: OpportunityScannerConfig = {},
): OpportunityScannerResult {
  const settings = { ...DEFAULT_CONFIG, ...config };
  const reports = candidates.map(runTradeEngine);

  const qualifiedReports = reports.filter((report) => {
    const isBuy =
      report.decision === "BUY_CALL" || report.decision === "BUY_PUT";
    const isWatch = settings.includeWatchlist && report.decision === "WATCH";

    return (
      (isBuy || isWatch) &&
      report.scores.trade >= settings.minimumTradeScore &&
      report.scores.options >= settings.minimumOptionScore &&
      report.confidence >= settings.minimumConfidence &&
      report.optionQuality.label !== "REJECT" &&
      report.trigger !== "FAILED"
    );
  });

  const opportunities = qualifiedReports
    .sort((a, b) => calculateRankingScore(b) - calculateRankingScore(a))
    .slice(0, Math.max(1, Math.min(20, settings.limit)))
    .map((report, index): ScannedOpportunity => ({
      rank: index + 1,
      tier: getTier(report),
      symbol: report.symbol,
      contract: report.contract,
      decision: report.decision,
      confidence: report.confidence,
      scores: report.scores,
      optionQuality: report.optionQuality,
      trigger: report.trigger,
      alignment: report.alignment,
      reasons: report.reasons,
      warnings: report.warnings,
      summary: report.summary,
    }));

  const goldCount = opportunities.filter((item) => item.tier === "GOLD").length;

  return {
    scanned: reports.length,
    qualified: qualifiedReports.length,
    rejected: reports.length - qualifiedReports.length,
    opportunities,
    message:
      opportunities.length === 0
        ? "لا توجد فرصة عقود تحقق شروط فهد الصارمة الآن."
        : goldCount > 0
          ? `تم العثور على ${goldCount} فرصة ذهبية من أصل ${reports.length} عقد مفحوص.`
          : `تم العثور على ${opportunities.length} فرصة قوية للمراقبة من أصل ${reports.length} عقد مفحوص.`,
  };
}
