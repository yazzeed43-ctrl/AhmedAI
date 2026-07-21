import { NextResponse } from "next/server";
import { diagnoseSpxwAvailability } from "@/lib/trading/spxw-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await diagnoseSpxwAvailability();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "SPXW_DIAGNOSTICS_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
