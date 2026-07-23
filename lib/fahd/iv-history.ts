import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface IVHistoryRecord {
  implied_volatility: number;
}

export async function saveIVHistory(input: {
  contractSymbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "CALL" | "PUT";
  impliedVolatility: number;
}) {
  await supabase.from("option_iv_history").insert({
    contract_symbol: input.contractSymbol,
    underlying: input.underlying,
    expiration: input.expiration,
    strike: input.strike,
    option_type: input.optionType,
    implied_volatility: input.impliedVolatility,
  });
}

export async function getIVHistory(
  contractSymbol: string
): Promise<IVHistoryRecord[]> {
  const { data, error } = await supabase
    .from("option_iv_history")
    .select("implied_volatility")
    .eq("contract_symbol", contractSymbol)
    .order("recorded_at", { ascending: false })
    .limit(252);

  if (error || !data) {
    return [];
  }

  return data as IVHistoryRecord[];
}

export function calculateIVRank(
  currentIV: number,
  history: IVHistoryRecord[]
): number {
  if (!Number.isFinite(currentIV) || history.length === 0) {
    return 50;
  }

  const values = history
    .map((x) => x.implied_volatility)
    .filter((v) => Number.isFinite(v));

  if (values.length === 0) {
    return 50;
  }

  const low = Math.min(...values);
  const high = Math.max(...values);

  if (high === low) {
    return 50;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(((currentIV - low) / (high - low)) * 100)
    )
  );
}

export function calculateIVPercentile(
  currentIV: number,
  history: IVHistoryRecord[]
): number {
  if (!Number.isFinite(currentIV) || history.length === 0) {
    return 50;
  }

  const values = history
    .map((x) => x.implied_volatility)
    .filter((v) => Number.isFinite(v));

  if (values.length === 0) {
    return 50;
  }

  const lowerCount = values.filter(
    (value) => value < currentIV
  ).length;

  return Math.round((lowerCount / values.length) * 100);
}

export async function getIVMetrics(
  contractSymbol: string,
  currentIV: number
) {
  const history = await getIVHistory(contractSymbol);

  return {
    ivRank: calculateIVRank(currentIV, history),
    ivPercentile: calculateIVPercentile(currentIV, history),
    samples: history.length,
  };
}