export interface GuardianTradeInput {
  marketScore: number;
  directionalStockScore: number;
  optionScore: number;
  spreadPercent: number;
  openInterest: number;
  volume: number;
  highImpactNews?: boolean;
}

export interface GuardianResult {
  approved: boolean;
  reasons: string[];
}

export function approveTrade(
  trade: GuardianTradeInput
): GuardianResult {
  const reasons: string[] = [];

  // Market Brain
  if (trade.marketScore < 60) {
    reasons.push("Market score too low");
  }

  // Stock Brain (Directional)
  if (trade.directionalStockScore < 75) {
    reasons.push("Directional stock score too low");
  }

  // Option Brain
  if (trade.optionScore < 85) {
    reasons.push("Option score too low");
  }

  // Liquidity
  if (trade.spreadPercent > 5) {
    reasons.push("Spread too wide");
  }

  if (trade.openInterest < 1000) {
    reasons.push("Open interest too low");
  }

  if (trade.volume < 500) {
    reasons.push("Volume too low");
  }

  // News
  if (trade.highImpactNews === true) {
    reasons.push("High impact news");
  }

  return {
    approved: reasons.length === 0,
    reasons,
  };
}