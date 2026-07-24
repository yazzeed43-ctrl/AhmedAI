import type { BaseOpportunity } from "./types";

export interface ContractFilterConfig {
  minPrice: number;
  maxPrice: number;
  minVolume: number;
  minOpenInterest: number;
  maxSpreadPercent: number;
  minDelta: number;
  maxDelta: number;
}

export function passesContractFilters(
  item: BaseOpportunity,
  config: ContractFilterConfig,
): boolean {
  const absDelta = item.delta === null ? 0 : Math.abs(item.delta);

  return (
    item.midpoint >= config.minPrice &&
    item.midpoint <= config.maxPrice &&
    item.volume >= config.minVolume &&
    item.openInterest >= config.minOpenInterest &&
    item.spreadPercent <= config.maxSpreadPercent &&
    absDelta >= config.minDelta &&
    absDelta <= config.maxDelta &&
    item.optionBrain.tier !== "REJECT"
  );
}
