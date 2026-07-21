import { NextResponse } from "next/server";
import { runFahdScannerV3 } from "@/lib/trading/fahd-scanner-v3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SYMBOLS = [
  "SPY", "QQQ", "IWM", "AAPL", "NVDA",
  "TSLA", "AMZN", "META", "AMD", "MSFT",
];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const result = await runFahdScannerV3({
      symbols: Array.isArray(body.symbols)
        ? body.symbols.filter((x): x is string => typeof x === "string")
        : DEFAULT_SYMBOLS,
      timeframe:
        body.timeframe === "1h" || body.timeframe === "1day"
          ? body.timeframe
          : "15min",
      maxDte: typeof body.maxDte === "number" ? body.maxDte : 7,
      maxResults: typeof body.maxResults === "number" ? body.maxResults : 2,
      minPrice: typeof body.minPrice === "number" ? body.minPrice : 0.30,
      maxPrice: typeof body.maxPrice === "number" ? body.maxPrice : 15,
      minVolume: typeof body.minVolume === "number" ? body.minVolume : 100,
      minOpenInterest:
        typeof body.minOpenInterest === "number" ? body.minOpenInterest : 500,
      maxSpreadPercent:
        typeof body.maxSpreadPercent === "number" ? body.maxSpreadPercent : 12,
      minDelta: typeof body.minDelta === "number" ? body.minDelta : 0.45,
      maxDelta: typeof body.maxDelta === "number" ? body.maxDelta : 0.70,
      minimumFinalScore:
        typeof body.minimumFinalScore === "number" ? body.minimumFinalScore : 78,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "FAHD_SCANNER_V3_FAILED", message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd Scanner V3",
    endpoint: "/api/golden-opportunities-v3",
    status:
      process.env.TRADIER_ACCESS_TOKEN || process.env.TRADIER_TOKEN
        ? "READY"
        : "TRADIER_TOKEN_REQUIRED",
    rules: { maxResults: 2, oneDirectionOnly: true, triggerRequired: true },
  });
}
