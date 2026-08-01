export interface ExplosionEngineConfig {
  minimumScore: number;
  minimumEdge: number;
  executableScore: number;
  minimumContractQuality: number;
  minimumScoreCoverage: number;
  maxConfirmationBars: number;
  stopFirstOnAmbiguousBar: boolean;
  requireClosedFiveMinuteCandle: boolean;
}

export const DEFAULT_EXPLOSION_CONFIG: ExplosionEngineConfig = {
  minimumScore: 65,
  minimumEdge: 10,
  executableScore: 80,
  minimumContractQuality: 75,
  minimumScoreCoverage: 0.85,
  maxConfirmationBars: 3,
  stopFirstOnAmbiguousBar: true,
  requireClosedFiveMinuteCandle: true,
};

export function validateExplosionConfig(
  config: ExplosionEngineConfig,
): void {
  const scores = [
    config.minimumScore,
    config.minimumEdge,
    config.executableScore,
    config.minimumContractQuality,
  ];

  if (scores.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error("Explosion score thresholds must be between 0 and 100");
  }
  if (
    !Number.isFinite(config.minimumScoreCoverage) ||
    config.minimumScoreCoverage < 0 ||
    config.minimumScoreCoverage > 1
  ) {
    throw new Error("minimumScoreCoverage must be between 0 and 1");
  }
  if (!Number.isInteger(config.maxConfirmationBars) || config.maxConfirmationBars < 1) {
    throw new Error("maxConfirmationBars must be a positive integer");
  }
}
