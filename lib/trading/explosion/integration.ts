import type { ExplosionDirection } from "./types";

export interface ExplosionContractCandidate {
  contractSymbol: string;
  direction: "CALL" | "PUT";
  contractScore: number;
  finalScore: number;
  midpoint: number;
  spreadPercent: number;
  volume: number;
  openInterest: number;
  [key: string]: unknown;
}

export function selectExplosionContract<T extends ExplosionContractCandidate>(
  direction: ExplosionDirection,
  opportunities: T[],
): T | null {
  if (direction === "NEUTRAL") return null;

  return (
    opportunities
      .filter((item) => item.direction === direction)
      .sort(
        (first, second) =>
          second.contractScore - first.contractScore ||
          second.finalScore - first.finalScore,
      )[0] ?? null
  );
}

export function contractPassedScannerLiquidity(
  contract: ExplosionContractCandidate | null,
): boolean {
  return Boolean(
    contract &&
      Number.isFinite(contract.midpoint) &&
      contract.midpoint > 0 &&
      Number.isFinite(contract.spreadPercent) &&
      contract.spreadPercent >= 0 &&
      Number.isFinite(contract.volume) &&
      contract.volume > 0 &&
      Number.isFinite(contract.openInterest) &&
      contract.openInterest > 0,
  );
}

export function mapEconomicDataStatus(
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE",
): "COMPLETE" | "PARTIAL" | "UNAVAILABLE" {
  return status === "AVAILABLE" ? "COMPLETE" : status;
}
