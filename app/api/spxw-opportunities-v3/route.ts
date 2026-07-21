import { NextResponse } from "next/server";
import { scanSpxwOpportunitiesV3 } from "@/lib/trading/spxw-scanner-v3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const result = await scanSpxwOpportunitiesV3({
      expiration:
        typeof body.expiration === "string" ? body.expiration : undefined,
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
    return NextResponse.json(
      {
        success: false,
        error: "SPXW_SCAN_V3_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd SPXW Scanner V3",
    endpoint: "/api/spxw-opportunities-v3",
    status:
      process.env.TRADIER_ACCESS_TOKEN || process.env.TRADIER_TOKEN
        ? "READY"
        : "TRADIER_TOKEN_REQUIRED",
    behavior: {
      lookupSymbol: "SPX",
      filteredRoot: "SPXW",
      discoversDailyExpirations: true,
      maximumResults: 2,
    },
  });
}
