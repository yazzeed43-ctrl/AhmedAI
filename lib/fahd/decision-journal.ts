import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase";

type JournalInput = {
  requestMessage: string;
  decision: any;
  source?: string;
};

type JournalSaveResult =
  | { saved: true; id: string | null; deduplicated: boolean }
  | { saved: false; reason: string };

const JOURNAL_TIMEOUT_MS = 1_200;
const DEDUPE_BUCKET_MS = 5 * 60 * 1_000;

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(objectValue[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function buildDedupeKey(input: JournalInput): string {
  const decision = input.decision ?? {};
  const bucket = Math.floor(Date.now() / DEDUPE_BUCKET_MS);
  const payload = {
    source: input.source ?? "fahd_chat",
    bucket,
    timeframe: decision.timeframe ?? null,
    decision: decision.decision ?? null,
    bias: decision.bias ?? null,
    price: finiteNumber(decision.primary?.price),
    conditions: decision.conditions ?? null,
  };

  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`decision journal timeout after ${ms}ms`));
    }, ms);
    timer.unref?.();
  });
}

export async function saveMarketDecisionJournalEntry(
  input: JournalInput,
): Promise<JournalSaveResult> {
  const decision = input.decision;
  if (!decision || typeof decision !== "object") {
    return { saved: false, reason: "invalid decision payload" };
  }

  const required = [decision.timeframe, decision.decision, decision.bias];
  if (required.some((value) => typeof value !== "string" || !value)) {
    return { saved: false, reason: "decision identity fields are incomplete" };
  }

  const primary = decision.primary ?? {};
  const confirmations = decision.confirmations ?? {};
  const probabilities = decision.probabilities ?? {};
  const components = decision.components ?? {};
  const dedupeKey = buildDedupeKey(input);

  const row = {
    source: input.source ?? "fahd_chat",
    request_message: input.requestMessage.slice(0, 4_000),
    underlying: String(decision.underlying ?? "SPX"),
    timeframe: String(decision.timeframe),
    decision: String(decision.decision),
    bias: String(decision.bias),
    market_score: finiteNumber(decision.marketScore),
    confidence: finiteNumber(decision.confidence),
    bullish_probability: finiteNumber(probabilities.bullish),
    bearish_probability: finiteNumber(probabilities.bearish),
    neutral_probability: finiteNumber(probabilities.neutral),
    price_at_decision: finiteNumber(primary.price),
    price_source:
      primary.priceSource ??
      primary.technicalSource ??
      primary.providerSymbol ??
      null,
    price_freshness: primary.dataStatus?.freshness ?? null,
    is_proxy: Boolean(primary.isProxy),
    proxy_symbol: primary.proxySymbol ?? null,
    proxy_factor: finiteNumber(primary.proxyFactor),
    trend_score: finiteNumber(components.trend),
    momentum_score: finiteNumber(components.momentum),
    zones_score: finiteNumber(components.zones),
    alignment_score: finiteNumber(components.alignment),
    risk_score: finiteNumber(components.risk),
    trigger_required:
      typeof decision.triggerRequired === "boolean"
        ? decision.triggerRequired
        : null,
    trigger_rule:
      typeof decision.triggerRule === "string" ? decision.triggerRule : null,
    trigger_conditions: decision.conditions ?? {},
    blocking_reasons: Array.isArray(decision.blockingReasons)
      ? decision.blockingReasons
      : [],
    primary_snapshot: primary,
    confirmations_snapshot: confirmations,
    raw_decision: decision,
    dedupe_key: dedupeKey,
  };

  try {
    const operation = supabase
      .from("fahd_decision_logs")
      .upsert(row, {
        onConflict: "dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle();

    const result = await Promise.race([operation, timeoutAfter(JOURNAL_TIMEOUT_MS)]);
    if (result.error) {
      console.error("Failed to save Fahd decision journal entry:", result.error);
      return { saved: false, reason: result.error.message };
    }

    return {
      saved: true,
      id: result.data?.id ?? null,
      deduplicated: !result.data?.id,
    };
  } catch (error) {
    console.error("Fahd decision journal write skipped:", error);
    return {
      saved: false,
      reason: error instanceof Error ? error.message : "unknown journal error",
    };
  }
}
