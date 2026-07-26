export type MarketSessionCheck =
  | { status: "OPEN" }
  | { status: "HOLIDAY"; reason: string }
  | { status: "UNAVAILABLE"; reason: string };

export function findTradierMarketSession(
  payload: any,
  sessionDate: string,
): MarketSessionCheck {
  const raw = payload?.calendar?.days?.day;
  const days = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const day = days.find((item: any) => String(item?.date) === sessionDate);
  if (!day) return { status: "UNAVAILABLE", reason: "Session date missing from Tradier calendar" };
  if (String(day.status).toLowerCase() === "open") return { status: "OPEN" };
  return {
    status: "HOLIDAY",
    reason: String(day.description || "US market is closed"),
  };
}

export async function checkTradierMarketSession(
  sessionDate: string,
  options: {
    token?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<MarketSessionCheck> {
  const token = (options.token ?? process.env.TRADIER_ACCESS_TOKEN)?.trim();
  const baseUrl = process.env.TRADIER_BASE_URL?.trim() || "https://api.tradier.com/v1";
  if (!token) return { status: "UNAVAILABLE", reason: "TRADIER_ACCESS_TOKEN is not configured" };
  const [year, month] = sessionDate.split("-").map(Number);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${baseUrl}/markets/calendar?month=${month}&year=${year}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      return { status: "UNAVAILABLE", reason: `Tradier calendar HTTP ${response.status}` };
    }
    return findTradierMarketSession(await response.json(), sessionDate);
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      reason: error instanceof Error ? error.message : "Tradier calendar request failed",
    };
  }
}
