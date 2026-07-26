export type PremarketCandidate = {
  rank: number;
  direction: "CALL" | "PUT";
  score: number;
  volume: number;
  openInterest: number;
};

export type PremarketRankedOpportunity<T extends PremarketCandidate> = T & {
  marketBias: "CALL_BIAS" | "PUT_BIAS" | "WAIT";
  marketScore: number;
  finalScore: number;
  preparationStatus: "WATCH_ONLY";
};

export function rankPremarketDirections<T extends PremarketCandidate>(input: {
  opportunities: T[];
  marketBias: "CALL_BIAS" | "PUT_BIAS" | "WAIT";
  bullishProbability: number;
  bearishProbability: number;
  minimumFinalScore?: number;
  resultsPerDirection?: number;
}): {
  calls: PremarketRankedOpportunity<T>[];
  puts: PremarketRankedOpportunity<T>[];
} {
  const minimumFinalScore = input.minimumFinalScore ?? 78;
  const limit = Math.max(1, Math.min(5, input.resultsPerDirection ?? 2));

  const ranked = input.opportunities
    .map((item): PremarketRankedOpportunity<T> => {
      const marketScore =
        item.direction === "CALL"
          ? input.bullishProbability
          : input.bearishProbability;
      return {
        ...item,
        marketBias: input.marketBias,
        marketScore,
        finalScore: Math.round(item.score * 0.6 + marketScore * 0.4),
        preparationStatus: "WATCH_ONLY",
      };
    })
    .filter((item) => item.finalScore >= minimumFinalScore);

  const takeDirection = (direction: "CALL" | "PUT") =>
    ranked
      .filter((item) => item.direction === direction)
      .sort(
        (first, second) =>
          second.finalScore - first.finalScore ||
          second.score - first.score ||
          second.volume - first.volume ||
          second.openInterest - first.openInterest,
      )
      .slice(0, limit)
      .map((item, index) => ({ ...item, rank: index + 1 }));

  return { calls: takeDirection("CALL"), puts: takeDirection("PUT") };
}
