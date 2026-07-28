import { NextResponse } from "next/server";

import {
  handleAnalyzeTradeRequest,
} from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();

    const response =
      await handleAnalyzeTradeRequest(body);

    return NextResponse.json(
      response.body,
      { status: response.status },
    );
  } catch (error) {
    console.error(
      "Analyze trade API error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "INTERNAL_SERVER_ERROR",
        message:
          "حدث خطأ أثناء تشغيل محرك تحليل الصفقة.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Fahd Trade Engine",
    endpoint: "/api/analyze-trade",
    method: "POST",
    status: "READY",
    modes: ["MANUAL", "AUTO"],
    socialIntelligence: true,
  });
}