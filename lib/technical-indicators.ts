// Technical Indicators V2

function assertValidPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error("Indicator period must be a positive integer");
  }
}

function assertEqualLength(arrays: number[][]): void {
  if (arrays.length === 0) return;
  const length = arrays[0].length;
  if (arrays.some((array) => array.length !== length)) {
    throw new Error("Indicator input arrays must have equal lengths");
  }
}

export function ema(values: number[], period: number): number[] {
  assertValidPeriod(period);
  if (values.length === 0) return [];

  const multiplier = 2 / (period + 1);
  const result: number[] = [values[0]];

  for (let index = 1; index < values.length; index += 1) {
    result.push(
      values[index] * multiplier +
      result[index - 1] * (1 - multiplier)
    );
  }

  return result;
}

export function sma(values: number[], period: number): number[] {
  assertValidPeriod(period);

  const result: number[] = [];
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];

    if (index >= period) {
      sum -= values[index - period];
    }

    result.push(
      index < period - 1
        ? Number.NaN
        : sum / period
    );
  }

  return result;
}

function stddev(
  values: number[],
  period: number,
  means: number[]
): number[] {
  assertValidPeriod(period);
  assertEqualLength([values, means]);

  return values.map((_value, index) => {
    if (index < period - 1 || Number.isNaN(means[index])) {
      return Number.NaN;
    }

    const slice = values.slice(index - period + 1, index + 1);
    const mean = means[index];
    const variance =
      slice.reduce(
        (total, value) => total + (value - mean) ** 2,
        0
      ) / period;

    return Math.sqrt(variance);
  });
}

export function rsi(values: number[], period = 14): number[] {
  assertValidPeriod(period);
  if (values.length === 0) return [];

  const result: number[] = [Number.NaN];
  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (index <= period) {
      averageGain += gain / period;
      averageLoss += loss / period;

      result.push(
        index === period
          ? 100 - 100 / (1 + averageGain / (averageLoss || 1e-10))
          : Number.NaN
      );
    } else {
      averageGain =
        (averageGain * (period - 1) + gain) / period;
      averageLoss =
        (averageLoss * (period - 1) + loss) / period;

      const relativeStrength =
        averageGain / (averageLoss || 1e-10);

      result.push(
        100 - 100 / (1 + relativeStrength)
      );
    }
  }

  return result;
}

export interface MacdResult {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
}

export function macd(
  values: number[],
  fastLength = 12,
  slowLength = 26,
  signalLength = 9
): MacdResult {
  const fast = ema(values, fastLength);
  const slow = ema(values, slowLength);
  const macdLine = values.map(
    (_value, index) => fast[index] - slow[index]
  );
  const signalLine = ema(macdLine, signalLength);
  const histogram = macdLine.map(
    (value, index) => value - signalLine[index]
  );

  return { macdLine, signalLine, histogram };
}

export interface BollingerResult {
  upper: number[];
  mid: number[];
  lower: number[];
}

export function bollingerBands(
  values: number[],
  period = 20,
  standardDeviationMultiplier = 2
): BollingerResult {
  const mid = sma(values, period);
  const deviation = stddev(values, period, mid);

  return {
    upper: mid.map(
      (mean, index) =>
        mean + deviation[index] * standardDeviationMultiplier
    ),
    mid,
    lower: mid.map(
      (mean, index) =>
        mean - deviation[index] * standardDeviationMultiplier
    ),
  };
}

export function trueRange(
  highs: number[],
  lows: number[],
  closes: number[]
): number[] {
  assertEqualLength([highs, lows, closes]);

  return highs.map((high, index) => {
    const low = lows[index];

    if (index === 0) {
      return high - low;
    }

    const previousClose = closes[index - 1];

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );
  });
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  assertValidPeriod(period);

  const ranges = trueRange(highs, lows, closes);
  if (ranges.length === 0) return [];

  const result: number[] = [ranges[0]];

  for (let index = 1; index < ranges.length; index += 1) {
    if (index < period) {
      const average =
        ranges
          .slice(0, index + 1)
          .reduce((sum, value) => sum + value, 0) /
        (index + 1);

      result.push(average);
    } else {
      result.push(
        (
          result[index - 1] * (period - 1) +
          ranges[index]
        ) / period
      );
    }
  }

  return result;
}

export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): number[] {
  assertEqualLength([highs, lows, closes, volumes]);

  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return closes.map((close, index) => {
    const typicalPrice =
      (highs[index] + lows[index] + close) / 3;

    const volume =
      Number.isFinite(volumes[index])
        ? Math.max(0, volumes[index])
        : 0;

    cumulativePriceVolume += typicalPrice * volume;
    cumulativeVolume += volume;

    return cumulativeVolume > 0
      ? cumulativePriceVolume / cumulativeVolume
      : typicalPrice;
  });
}

export function averageVolume(
  volumes: number[],
  period = 20
): number[] {
  return sma(volumes, period);
}

export function findSupportResistance(
  highs: number[],
  lows: number[],
  lookback = 50
): {
  resistance: number;
  support: number;
} {
  assertValidPeriod(lookback);

  if (highs.length === 0 || lows.length === 0) {
    throw new Error("High and low arrays cannot be empty");
  }

  return {
    resistance: Math.max(...highs.slice(-lookback)),
    support: Math.min(...lows.slice(-lookback)),
  };
}