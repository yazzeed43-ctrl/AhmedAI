export type OptionDirection = 'CALL' | 'PUT';

export interface OptionBrainInput {
  direction: OptionDirection;
  underlyingPrice: number;
  strike: number;
  daysToExpiration: number;
  bid: number;
  ask: number;
  midpoint: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  volume: number;
  openInterest: number;
}

export interface OptionBrainResult {
  score: number;
  tier: 'GOLD' | 'STRONG' | 'WATCH' | 'REJECT';
  reasons: string[];
  warnings: string[];
  metrics: {
    spreadPercent: number;
    volumeOpenInterestRatio: number | null;
    gammaExposureMagnitude: number | null;
    moneynessPercent: number;
    liquidityScore: number;
    greeksScore: number;
    volatilityScore: number;
    strikeScore: number;
    expirationScore: number;
    activityScore: number;
  };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function scoreLiquidity(
  spreadPercent: number,
  volume: number,
  openInterest: number
): number {
  let score = 0;

  if (spreadPercent <= 2) score += 15;
  else if (spreadPercent <= 5) score += 12;
  else if (spreadPercent <= 8) score += 8;
  else if (spreadPercent <= 12) score += 4;

  if (volume >= 5000) score += 8;
  else if (volume >= 1000) score += 6;
  else if (volume >= 500) score += 4;
  else if (volume >= 100) score += 2;

  if (openInterest >= 10000) score += 7;
  else if (openInterest >= 5000) score += 6;
  else if (openInterest >= 1000) score += 4;
  else if (openInterest >= 500) score += 2;

  return clamp(score, 0, 30);
}

function scoreGreeks(input: OptionBrainInput): number {
  let score = 0;
  const absDelta =
    input.delta === null ? null : Math.abs(input.delta);

  if (absDelta !== null && absDelta >= 0.5 && absDelta <= 0.7) {
    score += 10;
  } else if (absDelta !== null && absDelta >= 0.4 && absDelta <= 0.8) {
    score += 7;
  } else if (absDelta !== null) {
    score += 3;
  }

  if (input.gamma !== null) {
    if (input.gamma >= 0.03) score += 5;
    else if (input.gamma >= 0.015) score += 4;
    else if (input.gamma > 0) score += 2;
  }

  if (input.theta !== null) {
    const theta = Math.abs(input.theta);
    if (input.daysToExpiration === 0) {
      if (theta <= 1.5) score += 3;
    } else if (theta <= 0.75) {
      score += 4;
    } else if (theta <= 1.5) {
      score += 2;
    }
  }

  if (input.vega !== null) {
    if (input.vega >= 0.05 && input.vega <= 0.35) score += 4;
    else if (input.vega > 0) score += 2;
  }

  return clamp(score, 0, 23);
}

function scoreVolatility(iv: number | null): number {
  if (iv === null || !Number.isFinite(iv)) return 4;

  const ivPercent = iv <= 3 ? iv * 100 : iv;

  if (ivPercent >= 15 && ivPercent <= 45) return 12;
  if (ivPercent > 45 && ivPercent <= 70) return 8;
  if (ivPercent >= 8 && ivPercent < 15) return 7;
  if (ivPercent > 70) return 3;
  return 4;
}

function scoreStrike(
  underlyingPrice: number,
  strike: number
): number {
  if (underlyingPrice <= 0 || strike <= 0) return 0;

  const distance =
    Math.abs(strike - underlyingPrice) / underlyingPrice * 100;

  if (distance <= 0.5) return 12;
  if (distance <= 1) return 10;
  if (distance <= 2) return 7;
  if (distance <= 3) return 4;
  return 1;
}

function scoreExpiration(dte: number): number {
  if (dte >= 2 && dte <= 5) return 10;
  if (dte >= 1 && dte <= 7) return 7;
  if (dte === 0) return 3;
  if (dte <= 14) return 5;
  return 2;
}

function scoreActivity(
  volume: number,
  openInterest: number
): number {
  if (volume <= 0) return 0;
  if (openInterest <= 0) return volume >= 500 ? 8 : 4;

  const ratio = volume / openInterest;

  if (ratio >= 2 && volume >= 1000) return 13;
  if (ratio >= 1 && volume >= 500) return 10;
  if (ratio >= 0.5) return 7;
  if (ratio >= 0.2) return 4;
  return 2;
}

export function scoreOption(
  input: OptionBrainInput
): OptionBrainResult {
  const midpoint =
    input.midpoint > 0
      ? input.midpoint
      : input.bid > 0 && input.ask > 0
        ? (input.bid + input.ask) / 2
        : 0;

  const spreadPercent =
    midpoint > 0 && input.ask >= input.bid
      ? ((input.ask - input.bid) / midpoint) * 100
      : 999;

  const liquidityScore = scoreLiquidity(
    spreadPercent,
    input.volume,
    input.openInterest
  );

  const greeksScore = scoreGreeks(input);
  const volatilityScore = scoreVolatility(input.impliedVolatility);
  const strikeScore = scoreStrike(
    input.underlyingPrice,
    input.strike
  );
  const expirationScore = scoreExpiration(input.daysToExpiration);
  const activityScore = scoreActivity(
    input.volume,
    input.openInterest
  );

  const score = Math.round(
    clamp(
      liquidityScore +
      greeksScore +
      volatilityScore +
      strikeScore +
      expirationScore +
      activityScore
    )
  );

  const volumeOpenInterestRatio =
    input.openInterest > 0
      ? Number((input.volume / input.openInterest).toFixed(2))
      : null;

  const gammaExposureMagnitude =
    input.gamma !== null &&
    input.openInterest > 0 &&
    input.underlyingPrice > 0
      ? Number(
          (
            input.gamma *
            input.openInterest *
            100 *
            input.underlyingPrice
          ).toFixed(2)
        )
      : null;

  const moneynessPercent =
    input.underlyingPrice > 0
      ? Number(
          (
            Math.abs(input.strike - input.underlyingPrice) /
            input.underlyingPrice *
            100
          ).toFixed(2)
        )
      : 999;

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (spreadPercent <= 5) reasons.push('Excellent liquidity');

  if (
    volumeOpenInterestRatio !== null &&
    volumeOpenInterestRatio >= 1
  ) {
    reasons.push('Unusual options activity');
  }

  if (
    input.delta !== null &&
    Math.abs(input.delta) >= 0.5 &&
    Math.abs(input.delta) <= 0.7
  ) {
    reasons.push('Preferred delta range');
  }

  if (input.gamma !== null && input.gamma >= 0.03) {
    reasons.push('Strong gamma response');
  }

  if (moneynessPercent <= 1) {
    reasons.push('High-quality strike near ATM');
  }

  if (
    input.daysToExpiration >= 2 &&
    input.daysToExpiration <= 5
  ) {
    reasons.push('Preferred expiration window');
  }

  if (spreadPercent > 8) warnings.push('Spread is wider than preferred');
  if (input.openInterest < 500) warnings.push('Low open interest');
  if (input.volume < 100) warnings.push('Low option volume');
  if (input.daysToExpiration === 0) {
    warnings.push('0DTE contract has elevated risk');
  }
  if (input.gamma === null) warnings.push('Gamma unavailable');
  if (input.vega === null) warnings.push('Vega unavailable');
  if (input.impliedVolatility === null) {
    warnings.push('Implied volatility unavailable');
  }

  const tier =
    score >= 85
      ? 'GOLD'
      : score >= 72
        ? 'STRONG'
        : score >= 60
          ? 'WATCH'
          : 'REJECT';

  return {
    score,
    tier,
    reasons,
    warnings,
    metrics: {
      spreadPercent: Number(spreadPercent.toFixed(2)),
      volumeOpenInterestRatio,
      gammaExposureMagnitude,
      moneynessPercent,
      liquidityScore,
      greeksScore,
      volatilityScore,
      strikeScore,
      expirationScore,
      activityScore,
    },
  };
}
