export interface GuardianTradeInput {
  marketScore: number;
  stockScore: number;
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

  if (trade.marketScore < 90) reasons.push("Market score too low");
  if (trade.stockScore < 90) reasons.push("Stock score too low");
  if (trade.optionScore < 95) reasons.push("Option score too low");
  if (trade.spreadPercent > 5) reasons.push("Spread too wide");
  if (trade.openInterest < 1000) reasons.push("Open interest too low");
  if (trade.volume < 500) reasons.push("Volume too low");
  if (trade.highImpactNews) reasons.push("High impact news");

  return {
    approved: reasons.length === 0,
    reasons,
  };
}