import { NextResponse } from "next/server";

import {
  scanOptionOpportunities,
  type OpportunityScannerConfig,
} from "@/lib/trading/opportunity-scanner";
import type { TradeEngineInput } from "@/lib/trading/trade-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚠️ Deprecated: هذا المسار معزول عن باقي محركات فهد (Tradier +
// tradier-scanner + option-brain). يعتمد على مسار بيانات منفصل
// كليًا (trade-engine.ts + scoring-engine.ts) وما فيه أي مستهلك
// داخلي أو Cron يستدعيه حاليًا. أُبقي عليه بدون أي تغيير سلوك.
const DEPRECATED = true;
const REPLACEMENT_ENDPOINT = "/api/fahd-recommendations";

interface ScanRequest {
  candidates: TradeEngineInput[];
  config?: OpportunityScannerConfig;
}

function validateBody(body: unknown): body is ScanRequest {
  if (!body || typeof body !== "object") return false;

  const data = body as Partial<ScanRequest>;

  return (
    Array.isArray(data.candidates) &&
    data.candidates.length > 0 &&
    data.candidates.length <= 500
  );
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();

    if (!validateBody(body)) {
      return NextResponse.json(
        {
          success: false,
          deprecated: DEPRECATED,
          replacementEndpoint: REPLACEMENT_ENDPOINT,
          error: "INVALID_INPUT",
          message:
            "أرسل قائمة candidates تحتوي على عقد واحد على الأقل وبحد أقصى 500 عقد.",
        },
        { status: 400 },
      );
    }

    const result = scanOptionOpportunities(body.candidates, body.config);

    return NextResponse.json({
      success: true,
      deprecated: DEPRECATED,
      replacementEndpoint: REPLACEMENT_ENDPOINT,
      generatedAt: new Date().toISOString(),
      result,
    });
  } catch (error) {
    console.error("Opportunity scanner API error:", error);

    return NextResponse.json(
      {
        success: false,
        deprecated: DEPRECATED,
        replacementEndpoint: REPLACEMENT_ENDPOINT,
        error: "INTERNAL_SERVER_ERROR",
        message: "حدث خطأ أثناء فحص فرص عقود الأوبشن.",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    deprecated: DEPRECATED,
    replacementEndpoint: REPLACEMENT_ENDPOINT,
    service: "Fahd Golden Options Scanner",
    endpoint: "/api/scan-opportunities",
    method: "POST",
    status: "READY",
    limits: {
      maximumCandidates: 500,
      defaultTopResults: 5,
    },
  });
}
