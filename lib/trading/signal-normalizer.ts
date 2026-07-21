import type {
  Direction,
  MarketSignals,
  OptionSignals,
  StockSignals,
  TriggerStatus,
} from "./scoring-engine";

export interface RawMarketData {
  spy: {
    price: number;
    vwap?: number | null;
    ema20?: number | null;
    ema50?: number | null;
    rsi?: number | null;
    changePercent?: number | null;
  };

  qqq: {
    price: number;
    vwap?: number | null;
    ema20?: number | null;
    ema50?: number | null;
    rsi?: number | null;
    changePercent?: number | null;
  };

  vix?: {
    price?: number | null;
    changePercent?: number | null;
  };

  breadth?: {
    advanceDeclineRatio?: number | null;
    percentAboveVwap?: number | null;
  };

  sector?: {
    changePercent?: number | null;
    relativeStrength?: number | null;
  };
}

export interface RawStockData {
  symbol: string;
  price: number;

  vwap?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  ema200?: number | null;

  rsi?: number | null;
  macdHistogram?: number | null;
  adx?: number | null;

  relativeVolume?: number | null;
  volume?: number | null;
  averageVolume?: number | null;

  poc?: number | null;
  vah?: number | null;
  val?: number | null;

  support?: number | null;
  resistance?: number | null;

  relativeStrength?: number | null;

  catalyst?: {
    hasNews?: boolean;
    earningsSoon?: boolean;
    sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  };
}

export interface RawOptionData {
  symbol: string;
  strike: number;
  optionType: "CALL" | "PUT";
  expiration: string;

  bid?: number | null;
  ask?: number | null;
  last?: number | null;

  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  impliedVolatility?: number | null;

  volume?: number | null;
  openInterest?: number | null;

  underlyingPrice: number;
  daysToExpiration: number;
}

export interface TriggerData {
  direction: Direction;

  candleClose: number;
  previousCandleClose?: number | null;

  breakoutLevel?: number | null;
  breakdownLevel?: number | null;

  priceAboveVwap?: boolean;
  priceBelowVwap?: boolean;

  relativeVolume?: number | null;
}

export interface NormalizedTradeSignals {
  market: MarketSignals;
  stock: StockSignals;
  options: OptionSignals;

  marketDirection: Direction;
  stockDirection: Direction;
  trigger: TriggerStatus;

  warnings: string[];
}

const clamp = (value: number): number => {
  return Math.max(0, Math.min(100, Math.round(value)));
};

const scoreBoolean = (
  condition: boolean | null | undefined,
  trueScore = 85,
  falseScore = 25,
): number => {
  if (condition === null || condition === undefined) return 50;

  return condition ? trueScore : falseScore;
};

const scoreRsi = (
  rsi: number | null | undefined,
  direction: Direction,
): number => {
  if (rsi === null || rsi === undefined) return 50;

  if (direction === "CALL") {
    if (rsi >= 55 && rsi <= 70) return 90;
    if (rsi >= 50 && rsi < 55) return 70;
    if (rsi > 70 && rsi <= 78) return 60;
    if (rsi > 78) return 35;
    return 30;
  }

  if (direction === "PUT") {
    if (rsi >= 30 && rsi <= 45) return 90;
    if (rsi > 45 && rsi <= 50) return 70;
    if (rsi >= 22 && rsi < 30) return 60;
    if (rsi < 22) return 35;
    return 30;
  }

  return rsi >= 45 && rsi <= 55 ? 70 : 45;
};

const determineTrendDirection = (data: {
  price: number;
  vwap?: number | null;
  ema20?: number | null;
  ema50?: number | null;
}): Direction => {
  let bullishPoints = 0;
  let bearishPoints = 0;

  if (data.vwap !== null && data.vwap !== undefined) {
    if (data.price > data.vwap) bullishPoints += 1;
    if (data.price < data.vwap) bearishPoints += 1;
  }

  if (
    data.ema20 !== null &&
    data.ema20 !== undefined &&
    data.ema50 !== null &&
    data.ema50 !== undefined
  ) {
    if (data.ema20 > data.ema50) bullishPoints += 1;
    if (data.ema20 < data.ema50) bearishPoints += 1;
  }

  if (bullishPoints >= 2) return "CALL";
  if (bearishPoints >= 2) return "PUT";

  return "NEUTRAL";
};

const scoreTrend = (
  data: {
    price: number;
    vwap?: number | null;
    ema20?: number | null;
    ema50?: number | null;
    ema200?: number | null;
  },
  direction: Direction,
): number => {
  let score = 50;

  if (direction === "CALL") {
    if (data.vwap && data.price > data.vwap) score += 15;
    if (data.ema20 && data.price > data.ema20) score += 10;
    if (data.ema20 && data.ema50 && data.ema20 > data.ema50) score += 15;
    if (data.ema200 && data.price > data.ema200) score += 10;
  }

  if (direction === "PUT") {
    if (data.vwap && data.price < data.vwap) score += 15;
    if (data.ema20 && data.price < data.ema20) score += 10;
    if (data.ema20 && data.ema50 && data.ema20 < data.ema50) score += 15;
    if (data.ema200 && data.price < data.ema200) score += 10;
  }

  return clamp(score);
};

const scoreRelativeVolume = (
  relativeVolume: number | null | undefined,
): number => {
  if (relativeVolume === null || relativeVolume === undefined) return 50;

  if (relativeVolume >= 2) return 100;
  if (relativeVolume >= 1.5) return 90;
  if (relativeVolume >= 1.2) return 75;
  if (relativeVolume >= 1) return 60;
  if (relativeVolume >= 0.8) return 45;

  return 25;
};

const scoreAdx = (adx: number | null | undefined): number => {
  if (adx === null || adx === undefined) return 50;

  if (adx >= 35) return 95;
  if (adx >= 25) return 85;
  if (adx >= 20) return 70;
  if (adx >= 15) return 50;

  return 30;
};

const scoreVolumeProfile = (
  stock: RawStockData,
  direction: Direction,
): number => {
  if (
    stock.vah === null ||
    stock.vah === undefined ||
    stock.val === null ||
    stock.val === undefined
  ) {
    return 50;
  }

  if (direction === "CALL") {
    if (stock.price > stock.vah) return 90;
    if (stock.poc && stock.price > stock.poc) return 75;
    if (stock.price >= stock.val) return 55;

    return 30;
  }

  if (direction === "PUT") {
    if (stock.price < stock.val) return 90;
    if (stock.poc && stock.price < stock.poc) return 75;
    if (stock.price <= stock.vah) return 55;

    return 30;
  }

  return 50;
};

const scoreSupportResistance = (
  stock: RawStockData,
  direction: Direction,
): number => {
  if (direction === "CALL") {
    if (!stock.resistance) return 50;

    const distancePercent =
      ((stock.resistance - stock.price) / stock.price) * 100;

    if (stock.price > stock.resistance) return 90;
    if (distancePercent >= 0.5) return 75;
    if (distancePercent >= 0.2) return 55;

    return 35;
  }

  if (direction === "PUT") {
    if (!stock.support) return 50;

    const distancePercent =
      ((stock.price - stock.support) / stock.price) * 100;

    if (stock.price < stock.support) return 90;
    if (distancePercent >= 0.5) return 75;
    if (distancePercent >= 0.2) return 55;

    return 35;
  }

  return 50;
};

const scoreCatalyst = (stock: RawStockData): number => {
  const catalyst = stock.catalyst;

  if (!catalyst) return 50;

  let score = 50;

  if (catalyst.hasNews) score += 15;

  if (catalyst.sentiment === "POSITIVE") score += 20;
  if (catalyst.sentiment === "NEGATIVE") score -= 20;

  if (catalyst.earningsSoon) {
    score -= 15;
  }

  return clamp(score);
};

const scoreSpread = (option: RawOptionData): number => {
  if (
    option.bid === null ||
    option.bid === undefined ||
    option.ask === null ||
    option.ask === undefined ||
    option.ask <= 0
  ) {
    return 30;
  }

  const midpoint = (option.bid + option.ask) / 2;

  if (midpoint <= 0) return 30;

  const spreadPercent = ((option.ask - option.bid) / midpoint) * 100;

  if (spreadPercent <= 3) return 100;
  if (spreadPercent <= 5) return 90;
  if (spreadPercent <= 8) return 75;
  if (spreadPercent <= 12) return 55;
  if (spreadPercent <= 20) return 35;

  return 15;
};

const scoreDelta = (
  delta: number | null | undefined,
  optionType: "CALL" | "PUT",
): number => {
  if (delta === null || delta === undefined) return 40;

  const absoluteDelta = Math.abs(delta);

  if (absoluteDelta >= 0.5 && absoluteDelta <= 0.7) return 100;
  if (absoluteDelta >= 0.45 && absoluteDelta < 0.5) return 85;
  if (absoluteDelta > 0.7 && absoluteDelta <= 0.8) return 80;
  if (absoluteDelta >= 0.35 && absoluteDelta < 0.45) return 60;
  if (absoluteDelta > 0.8 && absoluteDelta <= 0.9) return 65;

  void optionType;

  return 30;
};

const scoreOptionVolume = (
  volume: number | null | undefined,
): number => {
  if (volume === null || volume === undefined) return 40;

  if (volume >= 10_000) return 100;
  if (volume >= 5_000) return 90;
  if (volume >= 1_000) return 80;
  if (volume >= 500) return 70;
  if (volume >= 100) return 55;
  if (volume >= 25) return 40;

  return 20;
};

const scoreOpenInterest = (
  openInterest: number | null | undefined,
): number => {
  if (openInterest === null || openInterest === undefined) return 40;

  if (openInterest >= 10_000) return 100;
  if (openInterest >= 5_000) return 90;
  if (openInterest >= 1_000) return 80;
  if (openInterest >= 500) return 70;
  if (openInterest >= 100) return 55;
  if (openInterest >= 25) return 40;

  return 20;
};

const scoreIv = (
  impliedVolatility: number | null | undefined,
): number => {
  if (
    impliedVolatility === null ||
    impliedVolatility === undefined
  ) {
    return 50;
  }

  const iv =
    impliedVolatility <= 3
      ? impliedVolatility * 100
      : impliedVolatility;

  if (iv >= 20 && iv <= 45) return 90;
  if (iv > 45 && iv <= 65) return 70;
  if (iv > 65 && iv <= 90) return 50;
  if (iv > 90) return 30;
  if (iv >= 10) return 65;

  return 45;
};

const scoreTheta = (
  theta: number | null | undefined,
  daysToExpiration: number,
): number => {
  if (theta === null || theta === undefined) {
    return daysToExpiration >= 3 ? 60 : 35;
  }

  const thetaLoss = Math.abs(theta);

  if (daysToExpiration >= 5 && thetaLoss <= 0.15) return 90;
  if (daysToExpiration >= 3 && thetaLoss <= 0.25) return 75;
  if (daysToExpiration >= 2 && thetaLoss <= 0.35) return 55;

  return 30;
};

const scoreExpiration = (daysToExpiration: number): number => {
  if (daysToExpiration >= 3 && daysToExpiration <= 7) return 100;
  if (daysToExpiration >= 8 && daysToExpiration <= 14) return 80;
  if (daysToExpiration === 2) return 65;
  if (daysToExpiration === 1) return 40;
  if (daysToExpiration === 0) return 15;

  return 55;
};

const scoreContractProximity = (
  option: RawOptionData,
): number => {
  if (option.underlyingPrice <= 0) return 40;

  const distancePercent =
    (Math.abs(option.strike - option.underlyingPrice) /
      option.underlyingPrice) *
    100;

  const isInTheMoney =
    option.optionType === "CALL"
      ? option.strike < option.underlyingPrice
      : option.strike > option.underlyingPrice;

  if (distancePercent <= 0.25) return 100;
  if (distancePercent <= 0.75) return 90;
  if (distancePercent <= 1.5) return isInTheMoney ? 85 : 75;
  if (distancePercent <= 3) return isInTheMoney ? 70 : 50;

  return 25;
};

const evaluateTrigger = (
  trigger: TriggerData,
): TriggerStatus => {
  const volumeConfirmed =
    trigger.relativeVolume === null ||
    trigger.relativeVolume === undefined
      ? false
      : trigger.relativeVolume >= 1.2;

  if (
    trigger.direction === "CALL" &&
    trigger.breakoutLevel !== null &&
    trigger.breakoutLevel !== undefined
  ) {
    const brokeResistance =
      trigger.candleClose > trigger.breakoutLevel;

    const previousWasBelow =
      trigger.previousCandleClose === null ||
      trigger.previousCandleClose === undefined ||
      trigger.previousCandleClose <= trigger.breakoutLevel;

    if (
      brokeResistance &&
      previousWasBelow &&
      trigger.priceAboveVwap &&
      volumeConfirmed
    ) {
      return "CONFIRMED";
    }

    if (
      trigger.candleClose < trigger.breakoutLevel &&
      trigger.previousCandleClose &&
      trigger.previousCandleClose > trigger.breakoutLevel
    ) {
      return "FAILED";
    }

    return "WAITING";
  }

  if (
    trigger.direction === "PUT" &&
    trigger.breakdownLevel !== null &&
    trigger.breakdownLevel !== undefined
  ) {
    const brokeSupport =
      trigger.candleClose < trigger.breakdownLevel;

    const previousWasAbove =
      trigger.previousCandleClose === null ||
      trigger.previousCandleClose === undefined ||
      trigger.previousCandleClose >= trigger.breakdownLevel;

    if (
      brokeSupport &&
      previousWasAbove &&
      trigger.priceBelowVwap &&
      volumeConfirmed
    ) {
      return "CONFIRMED";
    }

    if (
      trigger.candleClose > trigger.breakdownLevel &&
      trigger.previousCandleClose &&
      trigger.previousCandleClose < trigger.breakdownLevel
    ) {
      return "FAILED";
    }

    return "WAITING";
  }

  return "WAITING";
};

export function normalizeTradeSignals(params: {
  market: RawMarketData;
  stock: RawStockData;
  option: RawOptionData;
  trigger: TriggerData;
}): NormalizedTradeSignals {
  const warnings: string[] = [];

  const spyDirection = determineTrendDirection(params.market.spy);
  const qqqDirection = determineTrendDirection(params.market.qqq);

  let marketDirection: Direction = "NEUTRAL";

  if (spyDirection === qqqDirection) {
    marketDirection = spyDirection;
  } else if (spyDirection !== "NEUTRAL") {
    marketDirection = spyDirection;
    warnings.push("اتجاه SPY وQQQ غير متوافق بالكامل");
  } else {
    marketDirection = qqqDirection;
  }

  const stockDirection = determineTrendDirection(params.stock);

  const spyTrendScore = scoreTrend(
    params.market.spy,
    marketDirection,
  );

  const qqqTrendScore = scoreTrend(
    params.market.qqq,
    marketDirection,
  );

  const marketVwapScore = Math.round(
    (scoreBoolean(
      marketDirection === "CALL"
        ? params.market.spy.price >
            (params.market.spy.vwap ?? Number.POSITIVE_INFINITY)
        : params.market.spy.price <
            (params.market.spy.vwap ?? Number.NEGATIVE_INFINITY),
    ) +
      scoreBoolean(
        marketDirection === "CALL"
          ? params.market.qqq.price >
              (params.market.qqq.vwap ?? Number.POSITIVE_INFINITY)
          : params.market.qqq.price <
              (params.market.qqq.vwap ?? Number.NEGATIVE_INFINITY),
      )) /
      2,
  );

  const breadthRatio =
    params.market.breadth?.advanceDeclineRatio;

  let breadthScore = 50;

  if (breadthRatio !== null && breadthRatio !== undefined) {
    if (marketDirection === "CALL") {
      breadthScore =
        breadthRatio >= 2
          ? 95
          : breadthRatio >= 1.5
            ? 80
            : breadthRatio >= 1
              ? 60
              : 30;
    }

    if (marketDirection === "PUT") {
      breadthScore =
        breadthRatio <= 0.5
          ? 95
          : breadthRatio <= 0.7
            ? 80
            : breadthRatio < 1
              ? 60
              : 30;
    }
  }

  const vixChange =
    params.market.vix?.changePercent ?? null;

  let vixCondition = 50;

  if (vixChange !== null) {
    if (marketDirection === "CALL") {
      vixCondition =
        vixChange <= -3 ? 90 : vixChange < 0 ? 75 : 30;
    }

    if (marketDirection === "PUT") {
      vixCondition =
        vixChange >= 3 ? 90 : vixChange > 0 ? 75 : 30;
    }
  }

  const averageRsi =
    ((params.market.spy.rsi ?? 50) +
      (params.market.qqq.rsi ?? 50)) /
    2;

  const momentumScore = scoreRsi(
    averageRsi,
    marketDirection,
  );

  const sectorStrength = clamp(
    params.market.sector?.relativeStrength ?? 50,
  );

  const marketSignals: MarketSignals = {
    spyTrend: spyTrendScore,
    qqqTrend: qqqTrendScore,
    vwapPosition: marketVwapScore,
    breadth: breadthScore,
    vixCondition,
    momentum: momentumScore,
    sectorStrength,
  };

  const stockSignals: StockSignals = {
    trend: scoreTrend(params.stock, stockDirection),

    vwap: scoreBoolean(
      stockDirection === "CALL"
        ? params.stock.price >
            (params.stock.vwap ?? Number.POSITIVE_INFINITY)
        : params.stock.price <
            (params.stock.vwap ?? Number.NEGATIVE_INFINITY),
    ),

    volumeProfile: scoreVolumeProfile(
      params.stock,
      stockDirection,
    ),

    relativeVolume: scoreRelativeVolume(
      params.stock.relativeVolume,
    ),

    momentum: clamp(
      (scoreRsi(params.stock.rsi, stockDirection) +
        scoreAdx(params.stock.adx) +
        scoreBoolean(
          stockDirection === "CALL"
            ? (params.stock.macdHistogram ?? 0) > 0
            : (params.stock.macdHistogram ?? 0) < 0,
          85,
          35,
        )) /
        3,
    ),

    supportResistance: scoreSupportResistance(
      params.stock,
      stockDirection,
    ),

    relativeStrength: clamp(
      params.stock.relativeStrength ?? 50,
    ),

    catalyst: scoreCatalyst(params.stock),
  };

  const optionSignals: OptionSignals = {
    spread: scoreSpread(params.option),
    delta: scoreDelta(
      params.option.delta,
      params.option.optionType,
    ),
    volume: scoreOptionVolume(params.option.volume),
    openInterest: scoreOpenInterest(
      params.option.openInterest,
    ),
    ivCondition: scoreIv(
      params.option.impliedVolatility,
    ),
    theta: scoreTheta(
      params.option.theta,
      params.option.daysToExpiration,
    ),
    expiration: scoreExpiration(
      params.option.daysToExpiration,
    ),
    contractProximity: scoreContractProximity(
      params.option,
    ),
  };

  if (params.option.daysToExpiration <= 1) {
    warnings.push(
      "العقد قريب جدًا من الانتهاء ومخاطرة تآكل الوقت مرتفعة",
    );
  }

  if (optionSignals.spread < 50) {
    warnings.push("السبريد في العقد واسع");
  }

  if (optionSignals.delta < 60) {
    warnings.push("دلتا العقد خارج النطاق المفضل للمضاربة");
  }

  if (marketDirection === "NEUTRAL") {
    warnings.push("اتجاه السوق العام غير واضح");
  }

  if (stockDirection === "NEUTRAL") {
    warnings.push("اتجاه السهم غير واضح");
  }

  return {
    market: marketSignals,
    stock: stockSignals,
    options: optionSignals,
    marketDirection,
    stockDirection,
    trigger: evaluateTrigger(params.trigger),
    warnings,
  };
}
