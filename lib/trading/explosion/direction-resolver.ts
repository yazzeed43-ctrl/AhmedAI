import type { DirectionEvaluation, ExplosionDirection } from "./types";

export function resolveExplosionDirection(
  bullScore: number | null,
  bearScore: number | null,
  minimumScore: number,
  minimumEdge: number,
): DirectionEvaluation {
  if (bullScore === null || bearScore === null) {
    return {
      direction: "NEUTRAL",
      selectedExplosionScore: null,
      scoreEdge: null,
    };
  }

  const edge = Math.abs(bullScore - bearScore);
  let direction: ExplosionDirection = "NEUTRAL";

  if (edge >= minimumEdge) {
    if (bullScore >= minimumScore && bullScore > bearScore) direction = "CALL";
    if (bearScore >= minimumScore && bearScore > bullScore) direction = "PUT";
  }

  return {
    direction,
    selectedExplosionScore:
      direction === "CALL" ? bullScore : direction === "PUT" ? bearScore : null,
    scoreEdge: edge,
  };
}
