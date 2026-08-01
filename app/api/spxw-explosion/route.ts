import { NextResponse } from "next/server";
import { buildExplosionDiagnostic } from "@/lib/trading/explosion/diagnostic-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json(await buildExplosionDiagnostic());
  } catch (error) {
    return NextResponse.json(
      {
        mode: "DIAGNOSTIC_ONLY",
        decision: "WAIT_DATA",
        isExecutable: false,
        executableTrigger: null,
        error: error instanceof Error ? error.message : "تعذر بناء تشخيص الانفجار.",
      },
      { status: 503 },
    );
  }
}
