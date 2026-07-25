import type { TradierOption } from "./tradier-client";

export type SpxwScanStatus =
  | "WAIT"
  | "DATA_PROVIDER_ERROR"
  | "PARTIAL_DATA"
  | "NO_MATCH"
  | "OPPORTUNITIES_FOUND";

export interface SpxwProviderError {
  expiration: string | null;
  provider: "Tradier";
  code: string;
  message: string;
}

export type ExpirationScanResult =
  | { expiration: string; status: "SUCCESS"; contracts: TradierOption[] }
  | { expiration: string; status: "ERROR"; error: SpxwProviderError };

type LoadOptionChain = (
  symbol: string,
  expiration: string,
) => Promise<TradierOption[]>;

function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = message.match(/\b(?:Tradier\s+)?(\d{3})\b/)?.[1];

  if (httpStatus) return `HTTP_${httpStatus}`;

  const errorName = error instanceof Error ? error.name : "";
  if (
    errorName === "TimeoutError" ||
    errorName === "AbortError" ||
    /timeout|مهلة/i.test(message)
  ) {
    return "TIMEOUT";
  }

  return "REQUEST_FAILED";
}

export function sanitizeTradierError(
  expiration: string,
  error: unknown,
): SpxwProviderError {
  const code = providerErrorCode(error);

  return {
    expiration,
    provider: "Tradier",
    code,
    message:
      code === "TIMEOUT"
        ? "Tradier options chain request timed out"
        : "Tradier options chain request failed",
  };
}

export async function scanExpirationCandidates(
  expirations: string[],
  loadOptionChain: LoadOptionChain,
): Promise<ExpirationScanResult[]> {
  return Promise.all(
    expirations.map(async (expiration): Promise<ExpirationScanResult> => {
      try {
        const contracts = await loadOptionChain("SPX", expiration);
        return { expiration, status: "SUCCESS", contracts };
      } catch (error) {
        return {
          expiration,
          status: "ERROR",
          error: sanitizeTradierError(expiration, error),
        };
      }
    }),
  );
}

export function summarizeExpirationScans(
  results: ExpirationScanResult[],
  opportunitiesFound: number,
) {
  const successful = results.filter(
    (result): result is Extract<ExpirationScanResult, { status: "SUCCESS" }> =>
      result.status === "SUCCESS",
  );
  const failed = results.filter(
    (result): result is Extract<ExpirationScanResult, { status: "ERROR" }> =>
      result.status === "ERROR",
  );

  const expirationsRequested = results.length;
  const expirationsSucceeded = successful.length;
  const expirationsFailed = failed.length;
  const providerErrors = failed.map((result) => result.error);

  let status: Exclude<SpxwScanStatus, "WAIT">;

  if (expirationsRequested === 0) {
    status = "DATA_PROVIDER_ERROR";
    providerErrors.push({
      expiration: null,
      provider: "Tradier",
      code: "NO_EXPIRATIONS_AVAILABLE",
      message: "No eligible SPXW expirations were available to scan",
    });
  } else if (expirationsSucceeded === 0) {
    status = "DATA_PROVIDER_ERROR";
  } else if (expirationsFailed > 0) {
    status = "PARTIAL_DATA";
  } else {
    status = opportunitiesFound > 0 ? "OPPORTUNITIES_FOUND" : "NO_MATCH";
  }

  return {
    status,
    successful,
    expirationsRequested,
    expirationsSucceeded,
    expirationsFailed,
    providerErrors,
  };
}
