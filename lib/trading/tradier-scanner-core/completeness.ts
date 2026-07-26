export type TradierScanDataStatus =
  | "COMPLETE"
  | "PARTIAL_DATA"
  | "DATA_PROVIDER_ERROR";

export type TradierScanOutcome =
  | "OPPORTUNITIES_FOUND"
  | "NO_OPPORTUNITIES"
  | "UNKNOWN";

export type CompletionDiagnostic =
  | "NONE"
  | "EMPTY_REQUEST"
  | "INVALID_COUNTER"
  | "SYMBOL_COUNTER_MISMATCH"
  | "EXPIRATION_COUNTER_MISMATCH"
  | "NO_SUCCESSFUL_EXPIRATIONS";

export interface TradierScanCompletion {
  dataStatus: TradierScanDataStatus;
  outcome: TradierScanOutcome;
  diagnostic: CompletionDiagnostic;
}

export function deriveTradierScanCompletion(input: {
  symbolsRequested: number;
  symbolsWithAnySuccess: number;
  symbolsFailedCompletely: number;
  expirationsRequested: number;
  expirationsSucceeded: number;
  expirationsFailed: number;
  opportunityCount: number;
}): TradierScanCompletion {
  const counters = [
    input.symbolsRequested,
    input.symbolsWithAnySuccess,
    input.symbolsFailedCompletely,
    input.expirationsRequested,
    input.expirationsSucceeded,
    input.expirationsFailed,
    input.opportunityCount,
  ];

  if (!counters.every((value) => Number.isInteger(value) && value >= 0)) {
    return {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "INVALID_COUNTER",
    };
  }

  if (input.symbolsRequested === 0) {
    return {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "EMPTY_REQUEST",
    };
  }

  if (
    input.symbolsWithAnySuccess + input.symbolsFailedCompletely !==
      input.symbolsRequested ||
    input.symbolsWithAnySuccess > input.expirationsSucceeded
  ) {
    return {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "SYMBOL_COUNTER_MISMATCH",
    };
  }

  if (
    input.expirationsSucceeded + input.expirationsFailed !==
    input.expirationsRequested
  ) {
    return {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "EXPIRATION_COUNTER_MISMATCH",
    };
  }

  if (
    input.expirationsRequested === 0 ||
    input.symbolsWithAnySuccess === 0 ||
    input.expirationsSucceeded === 0
  ) {
    return {
      dataStatus: "DATA_PROVIDER_ERROR",
      outcome: "UNKNOWN",
      diagnostic: "NO_SUCCESSFUL_EXPIRATIONS",
    };
  }

  const outcome: TradierScanOutcome =
    input.opportunityCount > 0
      ? "OPPORTUNITIES_FOUND"
      : "NO_OPPORTUNITIES";

  if (
    input.symbolsFailedCompletely > 0 ||
    input.expirationsFailed > 0
  ) {
    return { dataStatus: "PARTIAL_DATA", outcome, diagnostic: "NONE" };
  }

  return { dataStatus: "COMPLETE", outcome, diagnostic: "NONE" };
}
