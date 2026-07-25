import { NextResponse } from "next/server";
import {
  buildSpxwTriggerPlan,
  followFixedSpxwTriggerPlans,
} from "@/lib/trading/spxw-trigger-engine";
import type { FixedTriggerState } from "@/lib/trading/spxw-candle-confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const followUpPlans = Array.isArray(body.plans)
      ? body.plans.filter(
          (plan): plan is FixedTriggerState =>
            Boolean(
              plan &&
                typeof plan === "object" &&
                ((plan as FixedTriggerState).direction === "CALL" ||
                  (plan as FixedTriggerState).direction === "PUT") &&
                Number.isFinite((plan as FixedTriggerState).triggerPrice) &&
                Number.isFinite(
                  (plan as FixedTriggerState).invalidationPrice,
                ),
            ),
        )
      : [];

    const result =
      followUpPlans.length > 0
        ? await followFixedSpxwTriggerPlans(followUpPlans)
        : await buildSpxwTriggerPlan({
            maxResults:
              typeof body.maxResults === "number" ? body.maxResults : 2,
            confirmationBufferPoints:
              typeof body.confirmationBufferPoints === "number"
                ? body.confirmationBufferPoints
                : 1.5,
            stopBufferPoints:
              typeof body.stopBufferPoints === "number"
                ? body.stopBufferPoints
                : 6,
            target1Points:
              typeof body.target1Points === "number"
                ? body.target1Points
                : 8,
            target2Points:
              typeof body.target2Points === "number"
                ? body.target2Points
                : 15,
          });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "SPXW_TRIGGER_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd SPXW Trigger Engine",
    endpoint: "/api/spxw-trigger",
    status:
      process.env.TRADIER_ACCESS_TOKEN || process.env.TRADIER_TOKEN
        ? "READY"
        : "TRADIER_TOKEN_REQUIRED",
    outputs: [
      "triggerPrice",
      "invalidationPrice",
      "target1Price",
      "target2Price",
      "rr1",
      "rr2",
      "state",
      "priceTouchedAt",
      "confirmedCandle",
    ],
  });
}
