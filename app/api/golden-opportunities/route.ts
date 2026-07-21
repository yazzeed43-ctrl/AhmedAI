import { NextResponse } from "next/server";
import { scanGoldenOpportunities } from "@/lib/trading/golden-scanner";

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

    const result = await scanGoldenOpportunities({
      symbols: Array.isArray(body.symbols)
        ? body.symbols.filter((x): x is string => typeof x === "string")
        : DEFAULT_SYMBOLS,
      timeframe:
        body.timeframe === "1h" || body.timeframe === "1day"
          ? body.timeframe
          : "15min",
      maxDte: typeof body.maxDte === "number" ? body.maxDte : 7,
      results: typeof body.results === "number" ? body.results : 3,
      minPrice: typeof body.minPrice === "number" ? body.minPrice : 0.30,
      maxPrice: typeof body.maxPrice === "number" ? body.maxPrice : 15,
      minVolume: typeof body.minVolume === "number" ? body.minVolume : 100,
      minOpenInterest:
        typeof body.minOpenInterest === "number" ? body.minOpenInterest : 500,
      maxSpreadPercent:
        typeof body.maxSpreadPercent === "number"
          ? body.maxSpreadPercent
          : 12,
      minDelta: typeof body.minDelta === "number" ? body.minDelta : 0.45,
      maxDelta: typeof body.maxDelta === "number" ? body.maxDelta : 0.70,
      minimumFinalScore:
        typeof body.minimumFinalScore === "number"
          ? body.minimumFinalScore
          : 80,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "GOLDEN_SCAN_FAILED", message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd Golden Scanner V2",
    endpoint: "/api/golden-opportunities",
    status:
      process.env.TRADIER_ACCESS_TOKEN ? "READY" : "TRADIER_TOKEN_REQUIRED",
  });
}
