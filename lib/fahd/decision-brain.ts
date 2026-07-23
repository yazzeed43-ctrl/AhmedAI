export type DecisionAction =
  | "BUY"
  | "WATCH"
  | "WAIT"
  | "REJECT";

export interface DecisionBrainInput {
  marketScore: number;
  directionalStockScore: number;
  optionScore: number;
  guardianApproved: boolean;
  suggestedContracts: number;
  ivRank?: number | null;
  ivPercentile?: number | null;
  ivSamples?: number;
  highImpactNews?: boolean;
}

export interface DecisionBrainResult {
  action: DecisionAction;
  approved: boolean;
  confidence: number;
  reasons: string[];
  blockingReasons: string[];
  components: {
    market: number;
    stock: number;
    option: number;
    iv: number;
    risk: number;
  };
}

const MIN_MARKET_SCORE = 60;
const MIN_DIRECTIONAL_STOCK_SCORE = 55;
const MIN_OPTION_SCORE = 80;
const MIN_BUY_CONFIDENCE = 75;
const MIN_WATCH_CONFIDENCE = 65;

function clamp(
  value: number,
  minimum = 0,
  maximum = 100
): number {
  return Math.max(
    minimum,
    Math.min(maximum, value)
  );
}

function scoreIV(
  ivRank?: number | null,
  ivPercentile?: number | null,
  samples = 0
): number {
  if (
    samples < 10 ||
    ivRank === null ||
    ivRank === undefined ||
    ivPercentile === null ||
    ivPercentile === undefined
  ) {
    return 50;
  }

  const average =
    (ivRank + ivPercentile) / 2;

  if (average <= 25) {
    return 90;
  }

  if (average <= 50) {
    return 80;
  }

  if (average <= 75) {
    return 65;
  }

  return 40;
}

export function makeTradeDecision(
  input: DecisionBrainInput
): DecisionBrainResult {
  const blockingReasons: string[] = [];
  const reasons: string[] = [];

  if (
    input.marketScore <
    MIN_MARKET_SCORE
  ) {
    blockingReasons.push(
      "Market score is below the minimum"
    );
  }

  if (
    input.directionalStockScore <
    MIN_DIRECTIONAL_STOCK_SCORE
  ) {
    blockingReasons.push(
      "Directional stock score is below the minimum"
    );
  }

  if (
    input.optionScore <
    MIN_OPTION_SCORE
  ) {
    blockingReasons.push(
      "Option score is below the minimum"
    );
  }

  if (!input.guardianApproved) {
    blockingReasons.push(
      "Guardian did not approve the trade"
    );
  }

  if (
    input.suggestedContracts < 1
  ) {
    blockingReasons.push(
      "Risk budget does not allow one contract"
    );
  }

  if (input.highImpactNews) {
    blockingReasons.push(
      "High-impact news risk is active"
    );
  }

  const ivScore =
    scoreIV(
      input.ivRank,
      input.ivPercentile,
      input.ivSamples
    );

  const riskScore =
    input.guardianApproved &&
    input.suggestedContracts >= 1
      ? 100
      : 0;

  const confidence =
    Math.round(
      clamp(
        input.marketScore * 0.25 +
        input.directionalStockScore * 0.25 +
        input.optionScore * 0.3 +
        ivScore * 0.1 +
        riskScore * 0.1
      )
    );

  if (
    input.marketScore >= 70
  ) {
    reasons.push(
      "Strong market alignment"
    );
  }

  if (
    input.directionalStockScore >= 55
  ) {
    reasons.push(
      "Stock direction is acceptable"
    );
  }

  if (
    input.directionalStockScore >= 75
  ) {
    reasons.push(
      "Strong stock alignment"
    );
  }

  if (
    input.optionScore >= 80
  ) {
    reasons.push(
      "Option contract passed quality requirements"
    );
  }

  if (
    input.optionScore >= 90
  ) {
    reasons.push(
      "High-quality option contract"
    );
  }

  if (
    input.ivSamples !== undefined &&
    input.ivSamples >= 10 &&
    ivScore >= 80
  ) {
    reasons.push(
      "IV history is favorable"
    );
  }

  if (
    input.ivSamples === undefined ||
    input.ivSamples < 10
  ) {
    reasons.push(
      "IV history is still being collected"
    );
  }

  if (
    input.guardianApproved &&
    input.suggestedContracts >= 1
  ) {
    reasons.push(
      "Risk controls passed"
    );
  }

  let action: DecisionAction;

  if (
    blockingReasons.length === 0 &&
    confidence >= MIN_BUY_CONFIDENCE
  ) {
    action = "BUY";
  } else if (
    input.guardianApproved &&
    input.suggestedContracts >= 1 &&
    confidence >= MIN_WATCH_CONFIDENCE
  ) {
    action = "WATCH";
  } else if (
    confidence >= 55
  ) {
    action = "WAIT";
  } else {
    action = "REJECT";
  }

  return {
    action,
    approved:
      action === "BUY",
    confidence,
    reasons,
    blockingReasons,
    components: {
      market:
        input.marketScore,
      stock:
        input.directionalStockScore,
      option:
        input.optionScore,
      iv:
        ivScore,
      risk:
        riskScore,
    },
  };
}