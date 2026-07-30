import { supabase } from "@/lib/supabase";
import { getTradierQuote } from "@/lib/tradier";

const HORIZONS = [15, 30, 60] as const;
type HorizonMinutes = (typeof HORIZONS)[number];

type DecisionRow = {
  id: string;
  created_at: string;
  decision: string;
  bias: string;
  price_at_decision: number | string | null;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyDirection(bias: string, startPrice: number, endPrice: number) {
  const move = endPrice - startPrice;
  if (bias === "CALL_BIAS") {
    return move > 0 ? "CORRECT" : move < 0 ? "INCORRECT" : "FLAT";
  }
  if (bias === "PUT_BIAS") {
    return move < 0 ? "CORRECT" : move > 0 ? "INCORRECT" : "FLAT";
  }
  return "NOT_SCORED_WAIT";
}

function dueAt(createdAt: string, horizonMinutes: HorizonMinutes) {
  return new Date(new Date(createdAt).getTime() + horizonMinutes * 60_000);
}

async function getCurrentSpxPrice() {
  const quote = await getTradierQuote("SPX");
  if (quote && typeof quote === "object" && "error" in quote) {
    throw new Error(String((quote as any).error));
  }

  const price =
    finiteNumber((quote as any)?.last) ??
    finiteNumber((quote as any)?.close) ??
    finiteNumber((quote as any)?.bid) ??
    finiteNumber((quote as any)?.ask);

  if (price === null || price <= 0) {
    throw new Error("SPX price unavailable for outcome evaluation");
  }

  return {
    price,
    source: "Tradier quote",
    rawQuote: quote,
  };
}

export async function evaluatePendingFahdDecisions(options?: {
  now?: Date;
  limit?: number;
}) {
  const now = options?.now ?? new Date();
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50));
  const oldestAllowed = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();

  const { data: decisions, error: readError } = await supabase
    .from("fahd_decision_logs")
    .select("id, created_at, decision, bias, price_at_decision")
    .gte("created_at", oldestAllowed)
    .not("price_at_decision", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (readError) throw readError;
  if (!decisions?.length) {
    return { checked: 0, inserted: 0, skipped: 0, errors: [] as string[] };
  }

  const ids = decisions.map((row: DecisionRow) => row.id);
  const { data: existing, error: existingError } = await supabase
    .from("fahd_decision_outcomes")
    .select("decision_id, horizon_minutes")
    .in("decision_id", ids);

  if (existingError) throw existingError;

  const existingKeys = new Set(
    (existing ?? []).map(
      (row: any) => `${row.decision_id}:${Number(row.horizon_minutes)}`,
    ),
  );

  const due: Array<{ decision: DecisionRow; horizon: HorizonMinutes }> = [];
  for (const decision of decisions as DecisionRow[]) {
    for (const horizon of HORIZONS) {
      const key = `${decision.id}:${horizon}`;
      if (!existingKeys.has(key) && dueAt(decision.created_at, horizon) <= now) {
        due.push({ decision, horizon });
      }
    }
  }

  if (!due.length) {
    return {
      checked: decisions.length,
      inserted: 0,
      skipped: decisions.length,
      errors: [] as string[],
    };
  }

  const errors: string[] = [];
  let current;
  try {
    current = await getCurrentSpxPrice();
  } catch (error) {
    return {
      checked: decisions.length,
      inserted: 0,
      skipped: due.length,
      errors: [(error as Error)?.message ?? "Failed to fetch SPX price"],
    };
  }

  const rows = due.flatMap(({ decision, horizon }) => {
    const startPrice = finiteNumber(decision.price_at_decision);
    if (startPrice === null || startPrice <= 0) {
      errors.push(`Invalid start price for decision ${decision.id}`);
      return [];
    }

    const endPrice = current.price;
    const movePoints = endPrice - startPrice;
    const movePercent = (movePoints / startPrice) * 100;

    return [
      {
        decision_id: decision.id,
        horizon_minutes: horizon,
        measured_at: now.toISOString(),
        start_price: startPrice,
        end_price: endPrice,
        high_price: null,
        low_price: null,
        move_points: Number(movePoints.toFixed(4)),
        move_percent: Number(movePercent.toFixed(6)),
        mfe_points: null,
        mae_points: null,
        direction_result: classifyDirection(
          decision.bias,
          startPrice,
          endPrice,
        ),
        timing_result: "NOT_AVAILABLE_WITH_QUOTE_ONLY",
        trigger_result: null,
        data_source: current.source,
        raw_outcome: {
          evaluatorVersion: "v1_quote_snapshot",
          scheduledHorizonMinutes: horizon,
          scheduledAt: dueAt(decision.created_at, horizon).toISOString(),
          measuredAt: now.toISOString(),
          note:
            "Quote snapshot captured at first evaluator run after the horizon. Historical candle high/low is not yet connected, so MFE/MAE remain null.",
        },
      },
    ];
  });

  if (!rows.length) {
    return { checked: decisions.length, inserted: 0, skipped: due.length, errors };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("fahd_decision_outcomes")
    .upsert(rows, { onConflict: "decision_id,horizon_minutes", ignoreDuplicates: true })
    .select("id");

  if (insertError) throw insertError;

  return {
    checked: decisions.length,
    due: due.length,
    inserted: inserted?.length ?? 0,
    skipped: Math.max(0, due.length - (inserted?.length ?? 0)),
    errors,
  };
}
