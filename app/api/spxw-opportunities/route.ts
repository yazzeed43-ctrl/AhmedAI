import { NextResponse } from "next/server";
import { scanSpxwOpportunities } from "@/lib/trading/spxw-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const result = await scanSpxwOpportunities({
      maxDte: typeof body.maxDte === "number" ? body.maxDte : 2,
      maxResults: typeof body.maxResults === "number" ? body.maxResults : 2,
      minimumFinalScore:
        typeof body.minimumFinalScore === "number"
          ? body.minimumFinalScore
          : 78,
      minPrice: typeof body.minPrice === "number" ? body.minPrice : 0.50,
      maxPrice: typeof body.maxPrice === "number" ? body.maxPrice : 20,
      minVolume: typeof body.minVolume === "number" ? body.minVolume : 50,
      minOpenInterest:
        typeof body.minOpenInterest === "number" ? body.minOpenInterest : 100,
      maxSpreadPercent:
        typeof body.maxSpreadPercent === "number"
          ? body.maxSpreadPercent
          : 12,
      minDelta: typeof body.minDelta === "number" ? body.minDelta : 0.45,
      maxDelta: typeof body.maxDelta === "number" ? body.maxDelta : 0.70,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "SPXW_SCAN_FAILED", message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd SPXW Scanner",
    endpoint: "/api/spxw-opportunities",
    status:
      process.env.TRADIER_ACCESS_TOKEN || process.env.TRADIER_TOKEN
        ? "READY"
        : "TRADIER_TOKEN_REQUIRED",
    rules: {
      roots: ["SPXW"],
      maximumResults: 2,
      directionFollowsMarket: true,
      triggerRequired: true,
    },
  });
}
