import { NextResponse } from "next/server";
import {
  buildSpxwTriggerPlan,
  followFixedSpxwTriggerPlans,
} from "@/lib/trading/spxw-trigger-engine";
import { getPositions } from "@/lib/tradier";
import {
  buildEconomicGateWithPositionWarning,
  fetchEconomicCalendarForGate,
} from "@/lib/trading/fahd-decision/fahd-economic-gate-integration";
import { getNewsModifierDecision } from "@/lib/trading/fahd-decision/get-news-modifier-decision";
import { applyNewsModifier } from "@/lib/trading/fahd-decision/apply-news-modifier";
import type { RawHeadline } from "@/lib/trading/fahd-decision/news-modifier-types";
import {
  executeSpxwTriggerPost,
  type SpxwTriggerRouteServiceDeps,
} from "@/lib/trading/fahd-decision/spxw-trigger-route-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FINNHUB_BASE = "https://finnhub.io/api/v1";

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function refreshEconomicGate() {
  const apiKey = process.env.FINNHUB_API_KEY;
  const calendar = apiKey
    ? await fetchEconomicCalendarForGate(apiKey, {
        fetchWithTimeout,
        formatDate,
        finnhubBase: FINNHUB_BASE,
      })
    : {
        events: [],
        dataStatus: "UNAVAILABLE" as const,
        fetchedAt: new Date().toISOString(),
      };
  return buildEconomicGateWithPositionWarning(calendar, { getPositions });
}

async function fetchDecisionHeadlines(): Promise<RawHeadline[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY is unavailable");
  const response = await fetchWithTimeout(
    `${FINNHUB_BASE}/news?category=general&token=${apiKey}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Finnhub news HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Finnhub news response is invalid");

  return payload.slice(0, 8).flatMap((item: any) => {
    const title =
      typeof item?.headline === "string" ? item.headline.trim() : "";
    const timestamp = Number(item?.datetime);
    if (!title || !Number.isFinite(timestamp) || timestamp <= 0) return [];
    return [{
      title,
      source: typeof item?.source === "string" ? item.source : undefined,
      publishedAt: new Date(timestamp * 1_000).toISOString(),
    }];
  });
}

async function classifyHeadlines(input: {
  symbol: string;
  headlines: RawHeadline[];
}): Promise<string> {
  const response = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_NEWS_MODEL || "claude-sonnet-4-6",
        max_tokens: 250,
        system:
          "Classify the current market-news effect for SPXW. Return valid JSON only: sentiment, confidence, scoreAdjustment from -8 to 4, and warnings.",
        messages: [{ role: "user", content: JSON.stringify(input) }],
      }),
    },
    12_000,
  );
  if (!response.ok) throw new Error(`News classifier HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.content)
    ? payload.content
        .filter((block: any) => block?.type === "text")
        .map((block: any) => String(block.text ?? ""))
        .join("")
        .trim()
    : "";
}

async function refreshNewsEvaluation(result: any) {
  const plan = Array.isArray(result?.plans) ? result.plans[0] : null;
  if (!plan) return { status: "NOT_REQUIRED" as const, application: null };

  const headlines = await fetchDecisionHeadlines();
  if (headlines.length === 0) {
    return { status: "NOT_REQUIRED" as const, application: null };
  }
  const modifier = await getNewsModifierDecision(
    { symbol: "SPXW", headlines, category: "breaking" },
    classifyHeadlines,
  );
  return {
    status: "COMPLETED" as const,
    application: applyNewsModifier(Number(plan.finalScore ?? 0), modifier, {
      positionSide: plan.direction === "PUT" ? "PUT" : "CALL",
      minimumFinalScore: 72,
    }),
  };
}

const defaultDeps: SpxwTriggerRouteServiceDeps = {
  build: buildSpxwTriggerPlan,
  follow: followFixedSpxwTriggerPlans,
  refreshEconomicGate,
  refreshNewsEvaluation,
};

export async function POST(request: Request) {
  const response = await executeSpxwTriggerPost(request, defaultDeps);
  return NextResponse.json(response.body, { status: response.status });
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
