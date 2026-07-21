export type Direction = "CALL" | "PUT" | "NEUTRAL";

export type TriggerStatus = "CONFIRMED" | "WAITING" | "FAILED";

export interface MarketSignals {
  spyTrend: number;
  qqqTrend: number;
  vwapPosition: number;
  breadth: number;
  vixCondition: number;
  momentum: number;
  sectorStrength: number;
}

export interface StockSignals {
  trend: number;
  vwap: number;
  volumeProfile: number;
  relativeVolume: number;
  momentum: number;
  supportResistance: number;
  relativeStrength: number;
  catalyst: number;
}

export interface OptionSignals {
  spread: number;
  delta: number;
  volume: number;
  openInterest: number;
  ivCondition: number;
  theta: number;
  expiration: number;
  contractProximity: number;
}

export type OptionQualityLabel =
  | "EXCELLENT"
  | "GOOD"
  | "FAIR"
  | "WEAK"
  | "REJECT";

export interface OptionQuality {
  score: number;
  label: OptionQualityLabel;
  components: {
    liquidity: number;
    spread: number;
    delta: number;
    iv: number;
    theta: number;
    expiration: number;
    proximity: number;
  };
  strengths: string[];
  weaknesses: string[];
}

export interface TradeEvaluationInput {
  market: MarketSignals;
  stock: StockSignals;
  options: OptionSignals;
  marketDirection: Direction;
  stockDirection: Direction;
  trigger: TriggerStatus;
}

export interface TradeEvaluation {
  marketScore: number;
  stockScore: number;
  optionsScore: number;
  optionQuality: OptionQuality;
  tradeScore: number;
  alignment: boolean;
  decision:
    | "BUY_CALL"
    | "BUY_PUT"
    | "WATCH"
    | "WAIT"
    | "REJECT_CONTRACT";
  reasons: string[];
}

const calculateWeightedScore = <T extends object>(
  values: T,
  weights: Partial<Record<keyof T, number>>,
): number => {
  let total = 0;
  let totalWeight = 0;
  const keys = Object.keys(weights) as Array<keyof T>;

  for (const key of keys) {
    const weight = weights[key] ?? 0;
    const rawValue = values[key];
    const numericValue = typeof rawValue === "number" ? rawValue : 0;
    const value = Math.max(0, Math.min(100, numericValue));
    total += value * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round(total / totalWeight);
};

const MARKET_WEIGHTS = {
  spyTrend: 20,
  qqqTrend: 20,
  vwapPosition: 15,
  breadth: 15,
  vixCondition: 10,
  momentum: 10,
  sectorStrength: 10,
} satisfies Record<keyof MarketSignals, number>;

const STOCK_WEIGHTS = {
  trend: 20,
  vwap: 15,
  volumeProfile: 15,
  relativeVolume: 15,
  momentum: 10,
  supportResistance: 10,
  relativeStrength: 10,
  catalyst: 5,
} satisfies Record<keyof StockSignals, number>;

const OPTIONS_WEIGHTS = {
  spread: 20,
  delta: 15,
  volume: 15,
  openInterest: 15,
  ivCondition: 10,
  theta: 10,
  expiration: 10,
  contractProximity: 5,
} satisfies Record<keyof OptionSignals, number>;

function getOptionQualityLabel(score: number): OptionQualityLabel {
  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 55) return "FAIR";
  if (score >= 45) return "WEAK";
  return "REJECT";
}

export function evaluateOptionQuality(options: OptionSignals): OptionQuality {
  const liquidity = calculateWeightedScore(
    { volume: options.volume, openInterest: options.openInterest },
    { volume: 45, openInterest: 55 },
  );

  const score = calculateWeightedScore(options, OPTIONS_WEIGHTS);
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (liquidity >= 70) strengths.push("سيولة العقد جيدة");
  else if (liquidity < 45) weaknesses.push("السيولة ضعيفة");

  if (options.spread >= 70) strengths.push("السبريد مناسب");
  else if (options.spread < 45) weaknesses.push("السبريد واسع");

  if (options.delta >= 65) strengths.push("Delta مناسبة للحركة المتوقعة");
  else if (options.delta < 45) weaknesses.push("Delta غير مناسبة للمضاربة");

  if (options.theta >= 65) strengths.push("ضغط Theta مقبول");
  else if (options.theta < 45) weaknesses.push("تآكل Theta مرتفع");

  if (options.ivCondition < 45) weaknesses.push("التذبذب الضمني غير مناسب");
  if (options.expiration < 45) weaknesses.push("مدة الاستحقاق قصيرة أو عالية المخاطرة");
  if (options.contractProximity < 45) weaknesses.push("العقد بعيد عن السعر الحالي");

  return {
    score,
    label: getOptionQualityLabel(score),
    components: {
      liquidity,
      spread: options.spread,
      delta: options.delta,
      iv: options.ivCondition,
      theta: options.theta,
      expiration: options.expiration,
      proximity: options.contractProximity,
    },
    strengths,
    weaknesses,
  };
}

export function evaluateTrade(
  input: TradeEvaluationInput,
): TradeEvaluation {
  const marketScore = calculateWeightedScore(input.market, MARKET_WEIGHTS);
  const stockScore = calculateWeightedScore(input.stock, STOCK_WEIGHTS);
  const optionQuality = evaluateOptionQuality(input.options);
  const optionsScore = optionQuality.score;

  const tradeScore = Math.round(
    marketScore * 0.3 + stockScore * 0.45 + optionsScore * 0.25,
  );

  const alignment =
    input.marketDirection !== "NEUTRAL" &&
    input.marketDirection === input.stockDirection;

  const reasons: string[] = [];

  if (!alignment) reasons.push("اتجاه السوق لا يتوافق مع اتجاه السهم");
  if (optionsScore < 55) reasons.push("سيولة أو جودة عقد الأوبشن غير مناسبة");
  if (input.trigger === "WAITING") reasons.push("إشارة الدخول لم تتأكد بعد");
  if (input.trigger === "FAILED") reasons.push("فشل الاختراق أو الكسر");

  let decision: TradeEvaluation["decision"] = "WAIT";

  if (optionQuality.label === "REJECT" || optionsScore < 45) {
    decision = "REJECT_CONTRACT";
  } else if (
    tradeScore >= 75 &&
    alignment &&
    input.trigger === "CONFIRMED" &&
    optionQuality.score >= 55
  ) {
    decision =
      input.stockDirection === "CALL"
        ? "BUY_CALL"
        : input.stockDirection === "PUT"
          ? "BUY_PUT"
          : "WAIT";
  } else if (tradeScore >= 60 && input.trigger !== "FAILED") {
    decision = "WATCH";
  }

  if (decision === "WAIT" && reasons.length === 0) {
    reasons.push("درجة الصفقة لا تحقق شروط الدخول");
  }

  return {
    marketScore,
    stockScore,
    optionsScore,
    optionQuality,
    tradeScore,
    alignment,
    decision,
    reasons,
  };
}