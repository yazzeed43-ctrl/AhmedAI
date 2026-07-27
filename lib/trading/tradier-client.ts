const TRADIER_BASE_URL = (
  process.env.TRADIER_BASE_URL?.trim() || "https://api.tradier.com/v1"
).replace(/\/+$/, "");

const TRADIER_QUOTES_BATCH_SIZE = 50;

function getToken(): string {
  const token = process.env.TRADIER_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("TRADIER_ACCESS_TOKEN is not configured");
  }
  return token;
}

// Timeout موحد لكل استدعاءات Tradier بهذا الملف. هذا الملف يُستخدم
// من محركات SPXW والسكانر الموحد، فتعليقه يعني تعليق تحليل تداول
// حقيقي — نفس نمط fetchWithTimeout بباقي الملفات الخارجية بالمشروع.
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function tradierGet<T>(
  path: string,
  params: Record<string, string | number | boolean>,
): Promise<T> {
  const url = new URL(`${TRADIER_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
      10_000,
    );
  } catch (error: any) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("انتهت مهلة الاتصال بـ Tradier، حاول مرة ثانية.");
    }
    throw error;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Tradier ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Tradier ${response.status}: invalid JSON response`,
    );
  }
}

export interface TradierQuote {
  symbol: string;
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  change_percentage?: number | null;
  volume?: number | null;
  average_volume?: number | null;
  trade_date?: number | string | null;
  bid_date?: number | string | null;
  ask_date?: number | string | null;
}

export interface TradierOption {
  symbol: string;
  description?: string;
  option_type: "call" | "put";
  strike: number;
  expiration_date: string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  greeks?: {
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    mid_iv?: number | null;
    smv_vol?: number | null;
  } | null;
}

function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function getTradierQuotes(
  symbols: string[],
): Promise<TradierQuote[]> {
  const normalizedSymbols = [
    ...new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)),
    ),
  ];

  if (normalizedSymbols.length === 0) return [];

  const quotes: TradierQuote[] = [];
  for (
    let offset = 0;
    offset < normalizedSymbols.length;
    offset += TRADIER_QUOTES_BATCH_SIZE
  ) {
    const batch = normalizedSymbols.slice(
      offset,
      offset + TRADIER_QUOTES_BATCH_SIZE,
    );
    const data = await tradierGet<{
      quotes?: { quote?: TradierQuote | TradierQuote[] };
    }>("/markets/quotes", {
      symbols: batch.join(","),
      greeks: false,
    });
    quotes.push(...arrayify(data.quotes?.quote));
  }

  return quotes;
}

export async function getTradierExpirations(symbol: string): Promise<string[]> {
  const data = await tradierGet<{
    expirations?: { date?: string | string[] };
  }>("/markets/options/expirations", {
    symbol,
    includeAllRoots: false,
    strikes: false,
  });
  return arrayify(data.expirations?.date);
}

export async function getTradierOptionChain(
  symbol: string,
  expiration: string,
): Promise<TradierOption[]> {
  const data = await tradierGet<{
    options?: { option?: TradierOption | TradierOption[] };
  }>("/markets/options/chains", {
    symbol,
    expiration,
    greeks: true,
  });
  return arrayify(data.options?.option);
}
