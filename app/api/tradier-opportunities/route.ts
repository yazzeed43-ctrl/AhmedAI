import { NextResponse } from "next/server";

import { scanTradierOpportunities } from "@/lib/trading/tradier-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "AAPL",
  "NVDA",
  "TSLA",
  "AMZN",
  "META",
  "AMD",
  "MSFT",
];

function parseSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SYMBOLS;
  return value.filter((item): item is string => typeof item === "string");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const result = await scanTradierOpportunities({
      symbols: parseSymbols(body.symbols),
      maxDte: typeof body.maxDte === "number" ? body.maxDte : 7,
      expirationsPerSymbol:
        typeof body.expirationsPerSymbol === "number"
          ? body.expirationsPerSymbol
          : 2,
      results: typeof body.results === "number" ? body.results : 5,
      minPrice: typeof body.minPrice === "number" ? body.minPrice : 0.30,
      maxPrice: typeof body.maxPrice === "number" ? body.maxPrice : 15,
      minVolume: typeof body.minVolume === "number" ? body.minVolume : 25,
      minOpenInterest:
        typeof body.minOpenInterest === "number" ? body.minOpenInterest : 100,
      maxSpreadPercent:
        typeof body.maxSpreadPercent === "number"
          ? body.maxSpreadPercent
          : 20,
      minDelta: typeof body.minDelta === "number" ? body.minDelta : 0.35,
      maxDelta: typeof body.maxDelta === "number" ? body.maxDelta : 0.80,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("TRADIER_ACCESS_TOKEN") ? 503 : 500;

    return NextResponse.json(
      {
        success: false,
        error:
          status === 503
            ? "TRADIER_NOT_CONFIGURED"
            : "TRADIER_SCAN_FAILED",
        message,
      },
      { status },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd Tradier Options Connector",
    endpoint: "/api/tradier-opportunities",
    status: process.env.TRADIER_ACCESS_TOKEN ? "READY" : "TOKEN_REQUIRED",
    method: "POST",
    defaultSymbols: DEFAULT_SYMBOLS,
  });
}
