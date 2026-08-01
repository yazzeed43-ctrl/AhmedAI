import type {
  ComponentResult,
  ExplosionComponents,
  ScoreEvaluation,
} from "./types";

const COMPONENT_NAMES = [
  "trend",
  "momentum",
  "volatility",
  "volume",
  "location",
  "structureLiquidity",
] as const;

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validateComponent(name: string, component: ComponentResult): string[] {
  const errors: string[] = [];
  if (!finiteNonNegative(component.maximumWeight)) {
    errors.push(`${name}: invalid maximumWeight`);
  }
  if (!finiteNonNegative(component.configuredMetricWeight)) {
    errors.push(`${name}: invalid configuredMetricWeight`);
  }
  if (
    !finiteNonNegative(component.availableMetricWeight) ||
    component.availableMetricWeight > component.configuredMetricWeight
  ) {
    errors.push(`${name}: invalid availableMetricWeight`);
  }
  if (!finiteNonNegative(component.bullEarned) || !finiteNonNegative(component.bearEarned)) {
    errors.push(`${name}: earned scores must be finite and non-negative`);
  }
  if (
    component.bullEarned > component.availableMetricWeight ||
    component.bearEarned > component.availableMetricWeight
  ) {
    errors.push(`${name}: earned score exceeds available metric weight`);
  }
  return errors;
}

function normalizedDirectionalScore(
  earned: number,
  component: ComponentResult,
): number {
  if (component.availableMetricWeight <= 0) return 0;
  const normalized =
    (earned / component.availableMetricWeight) * component.maximumWeight;
  return Math.max(0, Math.min(component.maximumWeight, normalized));
}

export function evaluateExplosionScores(
  components: ExplosionComponents,
  minimumCoverage: number,
): ScoreEvaluation {
  let configuredWeight = 0;
  let availableWeight = 0;
  let maximumWeight = 0;
  let bullScore = 0;
  let bearScore = 0;
  const reasons: string[] = [];
  const blockers: string[] = [];

  for (const name of COMPONENT_NAMES) {
    const component = components[name];
    const validationErrors = validateComponent(name, component);
    blockers.push(...validationErrors);
    configuredWeight += component.configuredMetricWeight;
    availableWeight += component.availableMetricWeight;
    maximumWeight += component.maximumWeight;
    bullScore += normalizedDirectionalScore(component.bullEarned, component);
    bearScore += normalizedDirectionalScore(component.bearEarned, component);
    reasons.push(...component.reasons);

    if (component.status === "REQUIRED_MISSING") {
      blockers.push(`${name}: required metrics missing (${component.missingMetrics.join(", ")})`);
    }
  }

  const scoreCoverage =
    configuredWeight > 0 ? availableWeight / configuredWeight : 0;
  if (Math.abs(maximumWeight - 100) > 0.001) {
    blockers.push(`Component maximum weights must total 100, received ${maximumWeight}`);
  }
  const requiredDataMissing =
    blockers.length > 0 || scoreCoverage < minimumCoverage;

  if (scoreCoverage < minimumCoverage) {
    blockers.push(
      `Score coverage ${(scoreCoverage * 100).toFixed(1)}% is below required ${(minimumCoverage * 100).toFixed(1)}%`,
    );
  }

  return {
    bullScore: requiredDataMissing ? null : Math.round(bullScore * 100) / 100,
    bearScore: requiredDataMissing ? null : Math.round(bearScore * 100) / 100,
    scoreCoverage,
    requiredDataMissing,
    reasons,
    blockers,
  };
}
