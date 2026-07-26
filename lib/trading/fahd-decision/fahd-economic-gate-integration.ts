/**
 * fahd-economic-gate-integration.ts
 *
 * الملف النهائي لطبقة تكامل البوابة الاقتصادية مع route.ts.
 * يجمع: تطبيع impact القوي (نص + رقم)، جلب Finnhub مع نافذة -60/+24h،
 * الفحص الكسول على مرحلتين للمراكز المفتوحة، وlog آمن بدون التوكن.
 *
 * الاعتماديات المفترضة موجودة في route.ts:
 *   - fetchWithTimeout(url, options, timeoutMs)
 *   - formatDate(date) => "YYYY-MM-DD"
 *   - getPositions() => من Tradier
 *   - FINNHUB_BASE
 */

import {
  evaluateEconomicGate,
  type DataStatus,
  type EconomicGateDecision,
  type EventImpact,
  type RawEconomicEvent,
} from "./economic-calendar-gate";

// ============================================================
// تطبيع impact — يتحمل نص ورقم، ويفشل بحذر (valid: false) لا بصمت
// ============================================================

export function normalizeEconomicImpact(value: unknown): {
  impact: EventImpact;
  valid: boolean;
} {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["high", "3"].includes(normalized)) {
      return { impact: "high", valid: true };
    }
    if (["medium", "med", "2"].includes(normalized)) {
      return { impact: "medium", valid: true };
    }
    if (["low", "1", "0"].includes(normalized)) {
      return { impact: "low", valid: true };
    }
    return { impact: "low", valid: false };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 3) return { impact: "high", valid: true };
    if (value >= 2) return { impact: "medium", valid: true };
    return { impact: "low", valid: true };
  }

  return { impact: "low", valid: false };
}

// ============================================================
// تطبيع التوقيت
// ============================================================

export function normalizeEconomicTimestamp(item: any): string | null {
  const candidates = [
    item?.datetime,
    item?.date && item?.time ? `${item.date}T${item.time}` : null,
  ];

  for (const candidate of candidates) {
    if (candidate == null) continue;

    const numericCandidate = Number(candidate);
    const parsed =
      Number.isFinite(numericCandidate) && numericCandidate > 0
        ? numericCandidate > 10_000_000_000
          ? numericCandidate
          : numericCandidate * 1000
        : Date.parse(String(candidate));

    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

// ============================================================
// الجلب + الكاش
// ============================================================

export type EconomicCalendarGateData = {
  events: RawEconomicEvent[];
  dataStatus: DataStatus;
  fetchedAt: string;
};

let economicGateCache: { data: EconomicCalendarGateData; expiresAt: number } | null = null;
const ECONOMIC_GATE_CACHE_MS = 5 * 60 * 1000;

/**
 * تسجيل عينة آمنة من استجابة Finnhub (بدون التوكن) — لتأكيد شكل الحقول فعلياً
 * قبل الاعتماد الكامل على normalizeEconomicImpact/normalizeEconomicTimestamp.
 * فعّالة فقط خارج production.
 */
function logFinnhubSampleIfNonProd(rawItems: any[]): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("Finnhub economic calendar sample:", {
    itemCount: rawItems.length,
    sample: rawItems.slice(0, 3).map((item: any) => ({
      event: item?.event,
      impact: item?.impact,
      date: item?.date,
      time: item?.time,
      datetime: item?.datetime,
      country: item?.country,
    })),
  });
}

export async function fetchEconomicCalendarForGate(
  apiKey: string,
  deps: {
    fetchWithTimeout: (url: string, options: RequestInit, timeoutMs: number) => Promise<Response>;
    formatDate: (date: Date) => string;
    finnhubBase: string;
  },
): Promise<EconomicCalendarGateData> {
  if (economicGateCache?.expiresAt && economicGateCache.expiresAt > Date.now()) {
    return economicGateCache.data;
  }

  const now = Date.now();
  const windowStart = now - 60 * 60_000;
  const windowEnd = now + 24 * 60 * 60_000;

  const from = new Date(windowStart);
  const to = new Date(windowEnd);

  try {
    const response = await deps.fetchWithTimeout(
      `${deps.finnhubBase}/calendar/economic?from=${deps.formatDate(from)}&to=${deps.formatDate(to)}&token=${apiKey}`,
      { cache: "no-store" },
      10_000,
    );

    if (!response.ok) {
      return { events: [], dataStatus: "UNAVAILABLE", fetchedAt: new Date().toISOString() };
    }

    const payload = await response.json();
    const rawItems = payload?.economicCalendar;

    if (!Array.isArray(rawItems)) {
      return { events: [], dataStatus: "UNAVAILABLE", fetchedAt: new Date().toISOString() };
    }

    logFinnhubSampleIfNonProd(rawItems);

    const events: RawEconomicEvent[] = [];
    let invalidRecords = 0;

    for (const item of rawItems) {
      const startsAt = normalizeEconomicTimestamp(item);
      if (!startsAt) {
        invalidRecords += 1;
        continue;
      }

      const timestamp = Date.parse(startsAt);
      if (timestamp < windowStart || timestamp > windowEnd) {
        continue;
      }

      const normalizedImpact = normalizeEconomicImpact(item?.impact);
      if (!normalizedImpact.valid) {
        invalidRecords += 1;
        // نُدرج الحدث رغم كل شيء بدل حذفه بصمت — لكن نضمّه في PARTIAL أدناه،
        // ونعطيه أسوأ تصنيف (low) كافتراض آمن، وليس تجاهله كلياً.
      }

      events.push({
        name:
          typeof item?.event === "string" && item.event.trim()
            ? item.event.trim()
            : "Unknown Economic Event",
        impact: normalizedImpact.impact,
        startsAt,
      });
    }

    const result: EconomicCalendarGateData = {
      events,
      dataStatus: invalidRecords > 0 ? "PARTIAL" : "AVAILABLE",
      fetchedAt: new Date().toISOString(),
    };

    economicGateCache = { data: result, expiresAt: Date.now() + ECONOMIC_GATE_CACHE_MS };
    return result;
  } catch (error) {
    console.error(
      "Finnhub economic gate fetch failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return { events: [], dataStatus: "UNAVAILABLE", fetchedAt: new Date().toISOString() };
  }
}

// ============================================================
// الفحص الكسول على مرحلتين
// ============================================================

export async function buildEconomicGateWithPositionWarning(
  calendarData: EconomicCalendarGateData,
  deps: { getPositions: () => Promise<unknown> },
): Promise<EconomicGateDecision> {
  const now = Date.now();

  const preliminaryGate = evaluateEconomicGate(calendarData.events, now, {
    dataStatus: calendarData.dataStatus,
    hasOpenPosition: false,
  });

  if (preliminaryGate.level === "NONE") {
    return preliminaryGate;
  }

  let hasOpenPosition = false;
  try {
    const rawPositions = await deps.getPositions();

    const positionList: any[] = Array.isArray(rawPositions)
      ? rawPositions
      : Array.isArray((rawPositions as any)?.positions)
        ? (rawPositions as any).positions
        : [];

    hasOpenPosition = positionList.some((position: any) => {
      const symbol = String(position?.symbol ?? "").trim().toUpperCase();
      return symbol === "SPX" || symbol.startsWith("SPXW");
    });
  } catch (error) {
    console.error(
      "Unable to check Tradier positions for economic gate:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  return evaluateEconomicGate(calendarData.events, now, {
    dataStatus: calendarData.dataStatus,
    hasOpenPosition,
  });
}
