import {
  getTradierExpirations,
  getTradierOptionChain,
  getTradierQuotes,
} from "./tradier-client";

type ProbeResult = {
  symbol: string;
  quoteFound: boolean;
  quotePrice: number | null;
  expirations: string[];
  chainContracts: number;
  roots: string[];
  error?: string;
};

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function optionRoot(symbol: string): string {
  const match = symbol.toUpperCase().match(/^([A-Z]+)\d{6}[CP]\d{8}$/);
  return match?.[1] ?? "UNKNOWN";
}

async function probeSymbol(symbol: string): Promise<ProbeResult> {
  try {
    const quote = (await getTradierQuotes([symbol]))[0];
    const quotePrice =
      numberOrNull(quote?.last) ??
      numberOrNull(quote?.close) ??
      (numberOrNull(quote?.bid) && numberOrNull(quote?.ask)
        ? ((quote!.bid as number) + (quote!.ask as number)) / 2
        : null);

    const expirations = await getTradierExpirations(symbol);
    const firstExpiration = expirations[0];

    if (!firstExpiration) {
      return {
        symbol,
        quoteFound: Boolean(quote),
        quotePrice,
        expirations: [],
        chainContracts: 0,
        roots: [],
      };
    }

    const chain = await getTradierOptionChain(symbol, firstExpiration);
    const roots = [...new Set(chain.map((item) => optionRoot(item.symbol)))];

    return {
      symbol,
      quoteFound: Boolean(quote),
      quotePrice,
      expirations,
      chainContracts: chain.length,
      roots,
    };
  } catch (error) {
    return {
      symbol,
      quoteFound: false,
      quotePrice: null,
      expirations: [],
      chainContracts: 0,
      roots: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function diagnoseSpxwAvailability() {
  const probes = await Promise.all([
    probeSymbol("SPX"),
    probeSymbol("SPXW"),
    probeSymbol("$SPX"),
  ]);

  const working = probes.find(
    (item) =>
      item.expirations.length > 0 &&
      item.chainContracts > 0 &&
      item.roots.some((root) => root === "SPXW" || root === "SPX"),
  );

  return {
    generatedAt: new Date().toISOString(),
    provider: "Tradier",
    status: working ? "SUPPORTED" : "NOT_AVAILABLE",
    recommendedSymbol: working?.symbol ?? null,
    probes,
    diagnosis: working
      ? `Tradier يعيد سلسلة عقود عبر الرمز ${working.symbol}.`
      : "حساب Tradier الحالي لا يعيد Expirations أو Option Chain لـ SPX/SPXW.",
    nextAction: working
      ? "استخدم recommendedSymbol في ماسح SPXW."
      : "استخدم مصدر بيانات بديل لـ SPXW أو فعّل صلاحية بيانات المؤشرات في Tradier.",
  };
}
