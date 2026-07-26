import { createClient } from "@supabase/supabase-js";

export type PremarketClaimResult =
  | "CLAIMED_NEW"
  | "CLAIMED_STALE"
  | "ALREADY_SENT"
  | "IN_PROGRESS"
  | "PARTIAL_REQUIRES_RECONCILIATION";

const STALE_PROCESSING_MS = 20 * 60 * 1000;

export function classifyExistingPremarketClaim(options: {
  status: string;
  updatedAt: string;
  now: Date;
}): Exclude<PremarketClaimResult, "CLAIMED_NEW"> {
  if (options.status === "SENT") return "ALREADY_SENT";
  if (["DELIVERY_STARTED", "DELIVERY_UNCONFIRMED", "PARTIAL_DELIVERY"].includes(options.status)) {
    return "PARTIAL_REQUIRES_RECONCILIATION";
  }
  const updatedAt = Date.parse(options.updatedAt);
  const stale = options.status === "FAILED" ||
    !Number.isFinite(updatedAt) || options.now.getTime() - updatedAt >= STALE_PROCESSING_MS;
  return stale ? "CLAIMED_STALE" : "IN_PROGRESS";
}

function getDeliveryClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase delivery store is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function claimPremarketSession(
  sessionDate: string,
  now = new Date(),
): Promise<PremarketClaimResult> {
  const client = getDeliveryClient();
  const nowIso = now.toISOString();
  const { error: insertError } = await client
    .from("premarket_watchlist_deliveries")
    .insert({ session_date: sessionDate, status: "PROCESSING", updated_at: nowIso });
  if (!insertError) return "CLAIMED_NEW";
  if (insertError.code !== "23505") {
    throw new Error(`Unable to claim premarket session: ${insertError.code ?? "UNKNOWN"}`);
  }

  const { data: existing, error: readError } = await client
    .from("premarket_watchlist_deliveries")
    .select("status,updated_at")
    .eq("session_date", sessionDate)
    .single();
  if (readError || !existing) {
    throw new Error(`Unable to read premarket claim: ${readError?.code ?? "NOT_FOUND"}`);
  }
  const existingDecision = classifyExistingPremarketClaim({
    status: String(existing.status),
    updatedAt: String(existing.updated_at),
    now,
  });
  if (existingDecision !== "CLAIMED_STALE") return existingDecision;

  const { data: reclaimed, error: reclaimError } = await client
    .from("premarket_watchlist_deliveries")
    .update({
      status: "PROCESSING",
      updated_at: nowIso,
      error_code: null,
      error_message: null,
      telegram_message_ids: [],
    })
    .eq("session_date", sessionDate)
    .eq("updated_at", existing.updated_at)
    .select("session_date")
    .maybeSingle();
  if (reclaimError) {
    throw new Error(`Unable to reclaim premarket session: ${reclaimError.code ?? "UNKNOWN"}`);
  }
  return reclaimed ? "CLAIMED_STALE" : "IN_PROGRESS";
}

async function updateExpectedRow(
  sessionDate: string,
  values: Record<string, unknown>,
  expectedStatus: string,
): Promise<void> {
  const { data, error } = await getDeliveryClient()
    .from("premarket_watchlist_deliveries")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("session_date", sessionDate)
    .eq("status", expectedStatus)
    .select("session_date")
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Premarket ledger update affected no expected row: ${error?.code ?? "ZERO_ROWS"}`);
  }
}

export async function savePremarketSessionReport(
  sessionDate: string,
  reportJson: unknown,
  formattedMessage: string,
  reportHash: string,
): Promise<void> {
  await updateExpectedRow(sessionDate, {
    report_json: reportJson,
    formatted_message: formattedMessage,
    report_hash: reportHash,
  }, "PROCESSING");
}

export async function markPremarketSessionSent(
  sessionDate: string,
  messageIds: number[],
): Promise<void> {
  await updateExpectedRow(sessionDate, {
    status: "SENT",
    telegram_message_ids: messageIds,
    sent_at: new Date().toISOString(),
  }, "DELIVERY_STARTED");
}

export async function markPremarketSessionDeliveryStarted(
  sessionDate: string,
): Promise<void> {
  await updateExpectedRow(sessionDate, { status: "DELIVERY_STARTED" }, "PROCESSING");
}

export async function markPremarketSessionPartial(
  sessionDate: string,
  messageIds: number[],
  message: string,
): Promise<void> {
  await updateExpectedRow(sessionDate, {
    status: "PARTIAL_DELIVERY",
    telegram_message_ids: messageIds,
    error_code: "TELEGRAM_PARTIAL_DELIVERY",
    error_message: message.slice(0, 500),
  }, "DELIVERY_STARTED");
}

export async function markPremarketSessionDeliveryUnconfirmed(
  sessionDate: string,
  messageIds: number[],
  message: string,
): Promise<void> {
  await updateExpectedRow(sessionDate, {
    status: "DELIVERY_UNCONFIRMED",
    telegram_message_ids: messageIds,
    error_code: "DELIVERY_UNCONFIRMED",
    error_message: message.slice(0, 500),
  }, "DELIVERY_STARTED");
}

export async function markPremarketSessionFailed(
  sessionDate: string,
  code: string,
  message: string,
): Promise<void> {
  const values = {
    status: "FAILED",
    error_code: code,
    error_message: message.slice(0, 500),
  };
  try {
    await updateExpectedRow(sessionDate, values, "DELIVERY_STARTED");
  } catch {
    await updateExpectedRow(sessionDate, values, "PROCESSING");
  }
}
