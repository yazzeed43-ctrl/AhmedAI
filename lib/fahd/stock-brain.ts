export type StockTrend = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type OptionDirection = 'CALL' | 'PUT';

export interface StockBrainInput {
  price: number;
  changePercent: number;
  marketChangePercent?: number | null;
  ema9: number;
  ema20: number;
  ema50: number;
  vwap: number | null;
  atr14: number;
  volume: number | null;
  averageVolume20: number | null;
  relativeVolume: number | null;
  previousHigh: number;
  previousLow: number;
  currentHigh: number;
  currentLow: number;
}

export interface StockBrainResult {
  score: number;
  directionalScore: number;
  trend: StockTrend;
  direction: OptionDirection;
  reasons: string[];
  warnings: string[];
  components: {
    relativeStrength: number;
    momentum: number;
    vwap: number;
    ema: number;
    volume: number;
    atr: number;
    structure: number;
  };
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function scoreRelativeStrength(
  stockChangePercent: number,
  marketChangePercent?: number | null
): number {
  if (
    typeof marketChangePercent !== 'number' ||
    !Number.isFinite(marketChangePercent)
  ) {
    if (stockChangePercent >= 2) return 20;
    if (stockChangePercent >= 1) return 17;
    if (stockChangePercent >= 0.25) return 13;
    if (stockChangePercent <= -2) return 0;
    if (stockChangePercent <= -1) return 3;
    if (stockChangePercent <= -0.25) return 7;
    return 10;
  }

  const relativeStrength = stockChangePercent - marketChangePercent;

  if (relativeStrength >= 2) return 20;
  if (relativeStrength >= 1) return 17;
  if (relativeStrength >= 0.25) return 13;
  if (relativeStrength <= -2) return 0;
  if (relativeStrength <= -1) return 3;
  if (relativeStrength <= -0.25) return 7;
  return 10;
}

function scoreMomentum(
  changePercent: number,
  price: number,
  ema9: number
): number {
  let score = 10;

  if (changePercent >= 2) score += 7;
  else if (changePercent >= 1) score += 5;
  else if (changePercent >= 0.25) score += 2;
  else if (changePercent <= -2) score -= 7;
  else if (changePercent <= -1) score -= 5;
  else if (changePercent <= -0.25) score -= 2;

  if (price > ema9) score += 3;
  else if (price < ema9) score -= 3;

  return clamp(score, 0, 20);
}

function scoreVwap(price: number, vwap: number | null): number {
  if (vwap === null || !Number.isFinite(vwap) || vwap <= 0) {
    return 8;
  }

  const distancePercent = ((price - vwap) / vwap) * 100;

  if (distancePercent >= 1) return 15;
  if (distancePercent >= 0.25) return 12;
  if (distancePercent <= -1) return 0;
  if (distancePercent <= -0.25) return 3;
  return 8;
}

function scoreEma(
  price: number,
  ema9: number,
  ema20: number,
  ema50: number
): number {
  let score = 0;
  if (price >= ema9) score += 10;
  if (price >= ema20) score += 10;
  if (price >= ema50) score += 10;
  return score;
}

function scoreVolume(
  relativeVolume: number | null,
  volume: number | null,
  averageVolume20: number | null
): number {
  if (
    typeof relativeVolume === 'number' &&
    Number.isFinite(relativeVolume)
  ) {
    if (relativeVolume >= 2) return 10;
    if (relativeVolume >= 1.5) return 9;
    if (relativeVolume >= 1.1) return 7;
    if (relativeVolume >= 0.8) return 5;
    return 2;
  }

  if (
    typeof volume === 'number' &&
    typeof averageVolume20 === 'number' &&
    averageVolume20 > 0
  ) {
    const ratio = volume / averageVolume20;
    if (ratio >= 2) return 10;
    if (ratio >= 1.5) return 9;
    if (ratio >= 1.1) return 7;
    if (ratio >= 0.8) return 5;
    return 2;
  }

  return 5;
}

function scoreAtr(atr14: number, price: number): number {
  if (!Number.isFinite(atr14) || atr14 <= 0 || price <= 0) {
    return 2;
  }

  const atrPercent = (atr14 / price) * 100;

  if (atrPercent >= 1 && atrPercent <= 4) return 5;
  if (atrPercent >= 0.5 && atrPercent <= 6) return 4;
  return 2;
}

function scoreStructure(
  previousHigh: number,
  previousLow: number,
  currentHigh: number,
  currentLow: number
): number {
  const higherHigh = currentHigh > previousHigh;
  const higherLow = currentLow > previousLow;
  const lowerHigh = currentHigh < previousHigh;
  const lowerLow = currentLow < previousLow;

  if (higherHigh && higherLow) return 10;
  if (lowerHigh && lowerLow) return 0;
  return 5;
}

export function scoreStock(
  input: StockBrainInput,
  direction: OptionDirection
): StockBrainResult {
  const components = {
    relativeStrength: scoreRelativeStrength(
      input.changePercent,
      input.marketChangePercent
    ),
    momentum: scoreMomentum(
      input.changePercent,
      input.price,
      input.ema9
    ),
    vwap: scoreVwap(input.price, input.vwap),
    ema: scoreEma(
      input.price,
      input.ema9,
      input.ema20,
      input.ema50
    ),
    volume: scoreVolume(
      input.relativeVolume,
      input.volume,
      input.averageVolume20
    ),
    atr: scoreAtr(input.atr14, input.price),
    structure: scoreStructure(
      input.previousHigh,
      input.previousLow,
      input.currentHigh,
      input.currentLow
    ),
  };

  const score = Math.round(
    clamp(
      Object.values(components).reduce(
        (sum, value) => sum + value,
        0
      )
    )
  );

  const trend: StockTrend =
    score >= 65
      ? 'BULLISH'
      : score <= 35
        ? 'BEARISH'
        : 'NEUTRAL';

  const directionalScore =
    direction === 'CALL'
      ? score
      : 100 - score;

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (components.relativeStrength >= 17) {
    reasons.push('High Relative Strength');
  }
  if (components.relativeStrength <= 3) {
    reasons.push('Weak Relative Strength');
  }
  if (components.momentum >= 15) {
    reasons.push('Strong Momentum');
  }
  if (components.momentum <= 5) {
    reasons.push('Bearish Momentum');
  }
  if (components.vwap >= 12) {
    reasons.push('Above VWAP');
  }
  if (components.vwap <= 3) {
    reasons.push('Below VWAP');
  }
  if (components.ema === 30) {
    reasons.push('Bullish EMA Alignment');
  }
  if (components.ema === 0) {
    reasons.push('Bearish EMA Alignment');
  }
  if (components.volume >= 7) {
    reasons.push('Strong Relative Volume');
  }
  if (components.structure === 10) {
    reasons.push('Higher High / Higher Low');
  }
  if (components.structure === 0) {
    reasons.push('Lower High / Lower Low');
  }

  if (
    input.vwap === null ||
    input.volume === null ||
    input.averageVolume20 === null
  ) {
    warnings.push('Some stock metrics are unavailable');
  }

  if (direction === 'CALL' && trend === 'BEARISH') {
    warnings.push('Stock trend conflicts with CALL direction');
  }

  if (direction === 'PUT' && trend === 'BULLISH') {
    warnings.push('Stock trend conflicts with PUT direction');
  }

  return {
    score,
    directionalScore: Math.round(clamp(directionalScore)),
    trend,
    direction,
    reasons,
    warnings,
    components,
  };
}