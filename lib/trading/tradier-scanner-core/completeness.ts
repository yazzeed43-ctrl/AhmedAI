export type TradierScanStatus =
  | "OPPORTUNITIES_FOUND"
  | "NO_MATCH"
  | "PARTIAL_DATA"
  | "DATA_PROVIDER_ERROR";

export function deriveTradierScanStatus(input: {
  symbolsRequested: number;
  symbolsSucceeded: number;
  symbolsFailed: number;
  opportunityCount: number;
}): TradierScanStatus {
  if (
    input.symbolsRequested <= 0 ||
    input.symbolsSucceeded + input.symbolsFailed !== input.symbolsRequested ||
    input.symbolsSucceeded === 0
  ) {
    return "DATA_PROVIDER_ERROR";
  }
  if (input.symbolsFailed > 0) return "PARTIAL_DATA";
  return input.opportunityCount > 0 ? "OPPORTUNITIES_FOUND" : "NO_MATCH";
}
