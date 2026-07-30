import { NextRequest, NextResponse } from "next/server";
import { evaluatePendingFahdDecisions } from "@/lib/fahd/decision-outcome-evaluator";

export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await evaluatePendingFahdDecisions();
    return NextResponse.json({
      ok: true,
      result,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Fahd decision outcome evaluation failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error)?.message ?? "Outcome evaluation failed",
        executedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
