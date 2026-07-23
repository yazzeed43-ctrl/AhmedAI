export type ExitAction =
  | "HOLD"
  | "MOVE_STOP_TO_BREAKEVEN"
  | "TAKE_PARTIAL_PROFIT"
  | "TRAIL_STOP"
  | "EXIT_FULL";

export interface ExitBrainInput {
  entryPrice: number;
  currentPrice: number;
  stopPrice: number;
  target1: number;
  target2: number;

  contracts: number;
  remainingContracts: number;

  highestPriceSinceEntry?: number;

  optionScore?: number;
  directionalStockScore?: number;
  marketScore?: number;

  theta?: number | null;
  daysToExpiration?: number;

  triggerStillValid?: boolean;
  marketDataFresh?: boolean;
  highImpactNews?: boolean;
}

export interface ExitBrainResult {
  action: ExitAction;
  shouldExit: boolean;
  shouldTakePartial: boolean;

  currentReturnPercent: number;
  currentPnLPerContract: number;
  totalPnL: number;

  nextStop: number;
  suggestedExitContracts: number;

  reasons: string[];
  warnings: string[];

  levels: {
    entry: number;
    current: number;
    originalStop: number;
    nextStop: number;
    target1: number;
    target2: number;
    highestPriceSinceEntry: number;
  };
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.max(
    minimum,
    Math.min(maximum, value)
  );
}

function roundPrice(
  value: number
): number {
  return Number(
    Math.max(0.01, value)
      .toFixed(2)
  );
}

function validNumber(
  value: number
): boolean {
  return Number.isFinite(value);
}

export function evaluateExit(
  input: ExitBrainInput
): ExitBrainResult {
  if (
    !validNumber(input.entryPrice) ||
    !validNumber(input.currentPrice) ||
    !validNumber(input.stopPrice) ||
    input.entryPrice <= 0 ||
    input.currentPrice <= 0 ||
    input.stopPrice <= 0
  ) {
    throw new Error(
      "Invalid exit brain price input"
    );
  }

  const reasons: string[] = [];
  const warnings: string[] = [];

  const remainingContracts =
    Math.max(
      0,
      Math.floor(
        input.remainingContracts
      )
    );

  const originalContracts =
    Math.max(
      0,
      Math.floor(
        input.contracts
      )
    );

  const highestPriceSinceEntry =
    Math.max(
      input.currentPrice,
      input.highestPriceSinceEntry ??
        input.currentPrice
    );

  const currentReturnPercent =
    (
      (
        input.currentPrice -
        input.entryPrice
      ) /
      input.entryPrice
    ) * 100;

  const currentPnLPerContract =
    (
      input.currentPrice -
      input.entryPrice
    ) * 100;

  const totalPnL =
    currentPnLPerContract *
    remainingContracts;

  const initialRisk =
    Math.max(
      0.01,
      input.entryPrice -
        input.stopPrice
    );

  const currentR =
    (
      input.currentPrice -
      input.entryPrice
    ) /
    initialRisk;

  let action: ExitAction =
    "HOLD";

  let nextStop =
    input.stopPrice;

  let suggestedExitContracts = 0;

  if (
    input.highImpactNews
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "High-impact news risk is active"
    );
  } else if (
    input.marketDataFresh === false
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Market data is stale"
    );
  } else if (
    input.triggerStillValid === false
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Entry trigger is no longer valid"
    );
  } else if (
    input.currentPrice <=
    input.stopPrice
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Stop price was reached"
    );
  } else if (
    input.optionScore !== undefined &&
    input.optionScore < 60
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Option quality deteriorated"
    );
  } else if (
    input.directionalStockScore !== undefined &&
    input.directionalStockScore < 45
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Stock direction deteriorated"
    );
  } else if (
    input.marketScore !== undefined &&
    input.marketScore < 45
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Market alignment deteriorated"
    );
  } else if (
    input.currentPrice >=
    input.target2
  ) {
    action = "EXIT_FULL";
    suggestedExitContracts =
      remainingContracts;
    reasons.push(
      "Second profit target reached"
    );
  } else if (
    input.currentPrice >=
    input.target1 &&
    remainingContracts > 1
  ) {
    action =
      "TAKE_PARTIAL_PROFIT";

    suggestedExitContracts =
      Math.max(
        1,
        Math.floor(
          remainingContracts / 2
        )
      );

    nextStop =
      Math.max(
        input.entryPrice,
        input.stopPrice
      );

    reasons.push(
      "First profit target reached"
    );

    reasons.push(
      "Move stop to breakeven on remaining contracts"
    );
  } else if (
    currentR >= 1.5
  ) {
    action =
      "TRAIL_STOP";

    const trailingDistance =
      Math.max(
        initialRisk * 0.75,
        highestPriceSinceEntry *
          0.12
      );

    nextStop =
      Math.max(
        input.entryPrice,
        highestPriceSinceEntry -
          trailingDistance
      );

    reasons.push(
      "Trade reached at least 1.5R"
    );

    reasons.push(
      "Trailing stop activated"
    );
  } else if (
    currentR >= 1
  ) {
    action =
      "MOVE_STOP_TO_BREAKEVEN";

    nextStop =
      Math.max(
        input.entryPrice,
        input.stopPrice
      );

    reasons.push(
      "Trade reached 1R"
    );

    reasons.push(
      "Stop moved to breakeven"
    );
  } else {
    reasons.push(
      "Trade remains within the original plan"
    );
  }

  if (
    input.daysToExpiration !== undefined &&
    input.daysToExpiration <= 1 &&
    currentReturnPercent < 10
  ) {
    warnings.push(
      "Expiration is very close and profit is limited"
    );
  }

  if (
    input.theta !== null &&
    input.theta !== undefined &&
    input.theta < -1 &&
    currentReturnPercent < 15
  ) {
    warnings.push(
      "Theta decay is high"
    );
  }

  if (
    originalContracts > 0 &&
    remainingContracts >
      originalContracts
  ) {
    warnings.push(
      "Remaining contracts exceed original contracts"
    );
  }

  nextStop =
    roundPrice(
      clamp(
        nextStop,
        0.01,
        Math.max(
          input.currentPrice,
          input.entryPrice
        )
      )
    );

  const shouldExit =
    action === "EXIT_FULL";

  const shouldTakePartial =
    action ===
    "TAKE_PARTIAL_PROFIT";

  return {
    action,
    shouldExit,
    shouldTakePartial,

    currentReturnPercent:
      Number(
        currentReturnPercent.toFixed(
          2
        )
      ),

    currentPnLPerContract:
      Number(
        currentPnLPerContract.toFixed(
          2
        )
      ),

    totalPnL:
      Number(
        totalPnL.toFixed(2)
      ),

    nextStop,
    suggestedExitContracts,

    reasons,
    warnings,

    levels: {
      entry:
        roundPrice(
          input.entryPrice
        ),
      current:
        roundPrice(
          input.currentPrice
        ),
      originalStop:
        roundPrice(
          input.stopPrice
        ),
      nextStop,
      target1:
        roundPrice(
          input.target1
        ),
      target2:
        roundPrice(
          input.target2
        ),
      highestPriceSinceEntry:
        roundPrice(
          highestPriceSinceEntry
        ),
    },
  };
}
