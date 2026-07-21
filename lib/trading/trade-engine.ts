import {
  evaluateTrade,
  type TradeEvaluation,
  type OptionQuality,
} from "./scoring-engine";

import {
  normalizeTradeSignals,
  type RawMarketData,
  type RawOptionData,
  type RawStockData,
  type TriggerData,
} from "./signal-normalizer";

export interface TradeEngineInput {
  market: RawMarketData;
  stock: RawStockData;
  option: RawOptionData;
  trigger: TriggerData;
}

export interface TradeEngineReport {
  symbol: string;
  contract: {
    optionType: "CALL" | "PUT";
    strike: number;
    expiration: string;
    daysToExpiration: number;
  };
  scores: {
    market: number;
    stock: number;
    options: number;
    trade: number;
  };
  optionQuality: OptionQuality;
  directions: {
    market: "CALL" | "PUT" | "NEUTRAL";
    stock: "CALL" | "PUT" | "NEUTRAL";
  };
  trigger: "CONFIRMED" | "WAITING" | "FAILED";
  alignment: boolean;
  decision: TradeEvaluation["decision"];
  confidence: number;
  reasons: string[];
  warnings: string[];
  summary: string;
}

const calculateConfidence = (
  evaluation: TradeEvaluation,
): number => {
  let confidence = evaluation.tradeScore;

  if (!evaluation.alignment) confidence -= 15;

  if (evaluation.decision === "REJECT_CONTRACT") {
    confidence = Math.min(confidence, 40);
  }

  if (evaluation.decision === "WATCH") {
    confidence = Math.min(confidence, 74);
  }

  if (evaluation.decision === "WAIT") {
    confidence = Math.min(confidence, 59);
  }

  return Math.max(0, Math.min(100, Math.round(confidence)));
};

const createArabicSummary = (
  report: Omit<TradeEngineReport, "summary">,
): string => {
  const decisionLabels: Record<
    TradeEngineReport["decision"],
    string
  > = {
    BUY_CALL: "شراء عقد كول",
    BUY_PUT: "شراء عقد بوت",
    WATCH: "مراقبة وانتظار التأكيد",
    WAIT: "انتظار وعدم الدخول",
    REJECT_CONTRACT: "رفض العقد",
  };

  const optionQualityLabels = {
    EXCELLENT: "ممتازة",
    GOOD: "جيدة",
    FAIR: "متوسطة",
    WEAK: "ضعيفة",
    REJECT: "مرفوضة",
  };

  const directionLabels = {
    CALL: "صاعد",
    PUT: "هابط",
    NEUTRAL: "محايد",
  };

  const triggerLabels = {
    CONFIRMED: "مؤكد",
    WAITING: "بانتظار التأكيد",
    FAILED: "فاشل",
  };

  const lines = [
    `الرمز: ${report.symbol}`,
    `القرار: ${decisionLabels[report.decision]}`,
    `الثقة: ${report.confidence}%`,
    `درجة السوق: ${report.scores.market}/100`,
    `درجة السهم: ${report.scores.stock}/100`,
    `درجة العقد: ${report.scores.options}/100`,
    `جودة العقد: ${report.optionQuality.score}/100 — ${
      optionQualityLabels[report.optionQuality.label]
    }`,
    `سيولة العقد: ${report.optionQuality.components.liquidity}/100`,
    `جودة السبريد: ${report.optionQuality.components.spread}/100`,
    `جودة Delta: ${report.optionQuality.components.delta}/100`,
    `ضغط Theta: ${report.optionQuality.components.theta}/100`,
    `حالة IV: ${report.optionQuality.components.iv}/100`,
    `درجة الصفقة: ${report.scores.trade}/100`,
    `اتجاه السوق: ${directionLabels[report.directions.market]}`,
    `اتجاه السهم: ${directionLabels[report.directions.stock]}`,
    `التفعيل: ${triggerLabels[report.trigger]}`,
    `توافق السوق والسهم: ${
      report.alignment ? "نعم" : "لا"
    }`,
  ];

  if (report.optionQuality.strengths.length > 0) {
    lines.push(
      `نقاط قوة العقد: ${report.optionQuality.strengths.join("، ")}`,
    );
  }

  if (report.optionQuality.weaknesses.length > 0) {
    lines.push(
      `نقاط ضعف العقد: ${report.optionQuality.weaknesses.join("، ")}`,
    );
  }

  if (report.reasons.length > 0) {
    lines.push(`الأسباب: ${report.reasons.join("، ")}`);
  }

  if (report.warnings.length > 0) {
    lines.push(`التحذيرات: ${report.warnings.join("، ")}`);
  }

  return lines.join("\n");
};

export function runTradeEngine(
  input: TradeEngineInput,
): TradeEngineReport {
  const normalized = normalizeTradeSignals({
    market: input.market,
    stock: input.stock,
    option: input.option,
    trigger: input.trigger,
  });

  const evaluation = evaluateTrade({
    market: normalized.market,
    stock: normalized.stock,
    options: normalized.options,
    marketDirection: normalized.marketDirection,
    stockDirection: normalized.stockDirection,
    trigger: normalized.trigger,
  });

  const confidence = calculateConfidence(evaluation);

  const baseReport: Omit<TradeEngineReport, "summary"> = {
    symbol: input.stock.symbol,

    contract: {
      optionType: input.option.optionType,
      strike: input.option.strike,
      expiration: input.option.expiration,
      daysToExpiration: input.option.daysToExpiration,
    },

    scores: {
      market: evaluation.marketScore,
      stock: evaluation.stockScore,
      options: evaluation.optionsScore,
      trade: evaluation.tradeScore,
    },

    optionQuality: evaluation.optionQuality,

    directions: {
      market: normalized.marketDirection,
      stock: normalized.stockDirection,
    },

    trigger: normalized.trigger,
    alignment: evaluation.alignment,
    decision: evaluation.decision,
    confidence,
    reasons: evaluation.reasons,
    warnings: normalized.warnings,
  };

  return {
    ...baseReport,
    summary: createArabicSummary(baseReport),
  };
}