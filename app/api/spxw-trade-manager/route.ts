import { NextResponse } from "next/server";
import { manageSpxwTrade } from "@/lib/trading/spxw-trade-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await manageSpxwTrade({
      contractSymbol: String(body.contractSymbol || ""),
      direction: body.direction,
      entryOptionPrice: Number(body.entryOptionPrice),
      quantity: body.quantity === undefined ? 1 : Number(body.quantity),
      triggerPrice: Number(body.triggerPrice),
      invalidationPrice: Number(body.invalidationPrice),
      target1Price: Number(body.target1Price),
      target2Price: Number(body.target2Price),
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "SPXW_TRADE_MANAGER_FAILED",
        message:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd SPXW Trade Manager V1",
    endpoint: "/api/spxw-trade-manager",
    status:
      process.env.TRADIER_ACCESS_TOKEN || process.env.TRADIER_TOKEN
        ? "READY"
        : "TRADIER_TOKEN_REQUIRED",
    states: ["OPEN", "TARGET1_HIT", "TARGET2_HIT", "STOP_HIT"],
    note: "يعمل عند الطلب ولا ينفذ أوامر تلقائياً.",
  });
}
