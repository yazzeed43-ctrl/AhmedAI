import { getIVMetrics, saveIVHistory } from "@/lib/fahd/iv-history";
import { clampScore, normalizeTier } from "./utils";
import type { BaseOpportunity, IVContext, TradierOpportunity } from "./types";

export const MIN_IV_SAMPLES = 10;

export function emptyIVContext(): IVContext {
  return {
    ivRank: null,
    ivPercentile: null,
    samples: 0,
    signal: "INSUFFICIENT_DATA",
    scoreAdjustment: 0,
  };
}

export function buildIVContext(
  ivRank: number,
  ivPercentile: number,
  samples: number,
): IVContext {
  if (samples < MIN_IV_SAMPLES) {
    return {
      ivRank,
      ivPercentile,
      samples,
      signal: "INSUFFICIENT_DATA",
      scoreAdjustment: 0,
    };
  }

  if (ivRank >= 80 || ivPercentile >= 80) {
    return {
      ivRank,
      ivPercentile,
      samples,
      signal: "HIGH",
      scoreAdjustment: -5,
    };
  }

  if (ivRank <= 20 && ivPercentile <= 25) {
    return {
      ivRank,
      ivPercentile,
      samples,
      signal: "LOW",
      scoreAdjustment: 4,
    };
  }

  return {
    ivRank,
    ivPercentile,
    samples,
    signal: "NORMAL",
    scoreAdjustment: 2,
  };
}

export async function enrichWithIVHistory(
  item: BaseOpportunity,
): Promise<Omit<TradierOpportunity, "rank">> {
  if (
    item.impliedVolatility === null ||
    !Number.isFinite(item.impliedVolatility)
  ) {
    return {
      ...item,
      ivContext: emptyIVContext(),
    };
  }

  try {
    const metrics = await getIVMetrics(
      item.contractSymbol,
      item.impliedVolatility,
    );

    const ivContext = buildIVContext(
      metrics.ivRank,
      metrics.ivPercentile,
      metrics.samples,
    );

    const score = clampScore(item.score + ivContext.scoreAdjustment);

    const reasons = [...item.reasons];
    const warnings = [...item.warnings];

    if (ivContext.signal === "LOW") {
      reasons.push("IV is low versus contract history");
    } else if (ivContext.signal === "NORMAL") {
      reasons.push("IV is within a normal historical range");
    } else if (ivContext.signal === "HIGH") {
      warnings.push("IV is elevated versus contract history");
    } else {
      warnings.push("Insufficient IV history for reliable rank");
    }

    await saveIVHistory({
      contractSymbol: item.contractSymbol,
      underlying: item.underlying,
      expiration: item.expiration,
      strike: item.strike,
      optionType: item.direction,
      impliedVolatility: item.impliedVolatility,
    });

    return {
      ...item,
      score,
      tier: normalizeTier(score),
      reasons,
      warnings,
      ivContext,
    };
  } catch {
    return {
      ...item,
      ivContext: emptyIVContext(),
      warnings: [...item.warnings, "IV history service unavailable"],
    };
  }
}
