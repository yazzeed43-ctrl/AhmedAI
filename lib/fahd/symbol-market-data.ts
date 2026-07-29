export type SymbolValidationStatus = "valid" | "invalid" | "unknown";

export interface SymbolValidationResult {
  symbol: string;
  status: SymbolValidationStatus;
  checkedAt: number;
}

const SYMBOL_PATTERN = /\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g;

export const SYMBOL_BLACKLIST = new Set([
  "API", "ETF", "CEO", "AI", "USA", "US", "RSI", "EMA", "SMA",
  "VWAP", "MACD", "VIX", "A", "B", "C", "D", "CALL", "PUT",
  "BUY", "SELL", "CHART", "TREND", "HIGH", "LOW", "OPEN", "CLOSE",
  "NOW", "TODAY", "WHY", "HOW", "ASK", "BID", "OK", "YES", "NO",
  "HI", "HELLO", "PLEASE", "THANKS", "GOOD", "BAD", "NEWS", "PRICE",
  "STOCK", "STOCKS", "MARKET", "TRADE", "TRADING", "UP", "DOWN", "IN",
  "ON", "AT", "TO", "OF", "IS", "IT", "BE", "DO", "GO", "SO", "IF",
  "OR", "AS", "AN", "MY", "ME", "ALL", "NOT", "CAN", "SEE", "GET",
  "NEW", "FOMC", "CPI", "GDP", "USD", "THE", "AND", "FOR", "ARE",
  "WITH", "FROM", "THIS", "THAT", "HAVE", "WILL", "YOU", "BUT",
  "BEFORE", "AFTER",
]);

const validationCache = new Map<string, SymbolValidationResult>();
const inFlightChecks = new Map<string, Promise<SymbolValidationResult>>();

const VALID_INVALID_TTL_MS = 6 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 60 * 1000;

function ttlFor(status: SymbolValidationStatus): number {
  return status === "unknown" ? UNKNOWN_TTL_MS : VALID_INVALID_TTL_MS;
}

function isCacheFresh(result: SymbolValidationResult, now = Date.now()): boolean {
  return now - result.checkedAt < ttlFor(result.status);
}

export function isBlacklistedWord(token: string): boolean {
  return SYMBOL_BLACKLIST.has(token.trim().toUpperCase());
}

export function extractTickerCandidates(text: string): string[] {
  const matches = text.toUpperCase().match(SYMBOL_PATTERN) ?? [];
  return [...new Set(matches.filter((token) => !isBlacklistedWord(token)))];
}

export async function validateSymbol(
  rawSymbol: string,
  checkAtProvider: (symbol: string) => Promise<boolean>,
): Promise<SymbolValidationResult> {
  const symbol = rawSymbol.trim().toUpperCase();
  const checkedAt = Date.now();

  if (
    symbol.length === 0 ||
    symbol.length > 6 ||
    !/^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/.test(symbol) ||
    isBlacklistedWord(symbol)
  ) {
    return { symbol, status: "invalid", checkedAt };
  }

  const cached = validationCache.get(symbol);
  if (cached && isCacheFresh(cached, checkedAt)) return cached;

  const existing = inFlightChecks.get(symbol);
  if (existing) return existing;

  const checkPromise = (async (): Promise<SymbolValidationResult> => {
    let status: SymbolValidationStatus;
    try {
      status = (await checkAtProvider(symbol)) ? "valid" : "invalid";
    } catch (error) {
      console.error(`Symbol validation provider error for ${symbol}:`, error);
      status = "unknown";
    }

    const result = { symbol, status, checkedAt: Date.now() } satisfies SymbolValidationResult;
    validationCache.set(symbol, result);
    return result;
  })();

  inFlightChecks.set(symbol, checkPromise);
  try {
    return await checkPromise;
  } finally {
    inFlightChecks.delete(symbol);
  }
}

export async function filterValidatedSymbols(
  symbols: string[],
  checkAtProvider: (symbol: string) => Promise<boolean>,
): Promise<string[]> {
  const results = await Promise.all(
    [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))].map((symbol) =>
      validateSymbol(symbol, checkAtProvider),
    ),
  );

  return results
    .filter((result) => result.status !== "invalid")
    .map((result) => result.symbol);
}

interface FinnhubSearchItem {
  symbol?: unknown;
}

interface FinnhubSearchPayload {
  result?: unknown;
}

export async function filterSymbolsForFinnhub(
  symbols: string[],
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const checkAtProvider = async (symbol: string): Promise<boolean> => {
    const response = await request(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );

    if (!response.ok) {
      throw new Error(`Finnhub symbol lookup HTTP ${response.status}`);
    }

    const payload = (await response.json()) as FinnhubSearchPayload;
    if (!Array.isArray(payload.result)) return false;

    return payload.result.some((item: FinnhubSearchItem) =>
      typeof item?.symbol === "string" && item.symbol.toUpperCase() === symbol,
    );
  };

  return filterValidatedSymbols(symbols, checkAtProvider);
}

export function clearSymbolValidationCacheForTests(): void {
  validationCache.clear();
  inFlightChecks.clear();
}
