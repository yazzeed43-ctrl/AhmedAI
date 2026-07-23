export interface GuardianInput {
  marketScore: number;
  directionalStockScore: number;
  optionScore: number;

  spreadPercent: number;
  openInterest: number;
  volume: number;

  ivRank: number;

  highImpactNews: boolean;
}

export interface GuardianResult {
  approved: boolean;
  reasons: string[];
}

const MIN_MARKET_SCORE = 60;
const MIN_DIRECTIONAL_STOCK_SCORE = 55;
const MIN_OPTION_SCORE = 80;
const MAX_SPREAD_PERCENT = 5;
const MIN_OPEN_INTEREST = 500;
const MIN_VOLUME = 100;
const MIN_IV_RANK = 20;

export function approveTrade(
  input: GuardianInput
): GuardianResult {
  const reasons: string[] = [];

  if (input.marketScore < MIN_MARKET_SCORE) {
    reasons.push("Market score too low");
  }

  if (
    input.directionalStockScore <
    MIN_DIRECTIONAL_STOCK_SCORE
  ) {
    reasons.push("Directional stock score too low");
  }

  if (
    input.optionScore <
    MIN_OPTION_SCORE
  ) {
    reasons.push("Option score too low");
  }

  if (
    input.spreadPercent >
    MAX_SPREAD_PERCENT
  ) {
    reasons.push("Spread too wide");
  }

  if (
    input.openInterest <
    MIN_OPEN_INTEREST
  ) {
    reasons.push("Open interest too low");
  }

  if (
    input.volume <
    MIN_VOLUME
  ) {
    reasons.push("Volume too low");
  }

  if (
    input.ivRank > 0 &&
    input.ivRank < MIN_IV_RANK
  ) {
    reasons.push("IV Rank too low");
  }

  if (input.highImpactNews) {
    reasons.push("High impact news");
  }

  return {
    approved: reasons.length === 0,
    reasons,
  };
}