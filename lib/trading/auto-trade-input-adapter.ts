// lib/trading/auto-trade-input-adapter.ts
//
// (د.1) Auto Trade Input Adapter
// يحوّل مخرجات المسار الآلي (selectOptionContract + buildTriggerData)
// إلى مدخلات runTradeEngine() القديمة (RawOptionData + TriggerData)
// بدون تكرار أو تعارض منطق التفعيل.
//
// القرار الجوهري: مصدر الحقيقة الوحيد لحالة التفعيل هو evaluateCandleConfirmation()
// من الخطوة (د). لا نعيد بناء منطق RVOL/VWAP القديم لمسار AUTO؛ فقط نمرر
// confirmationStatus صراحة عبر التعديل التوافقي بـ TriggerData (signal-normalizer.ts —
// راجع README-signal-normalizer-patch.md)، والحقول القديمة تُملأ بأفضل قيم
// حقيقية متاحة (بدون اختراع) لغرض التوثيق فقط، لأنها لا تؤثر على القرار
// بمجرد وجود confirmationStatus.
//
// ⚠️ متطلب مسبق: يجب تطبيق التعديل التوافقي بـ lib/trading/signal-normalizer.ts
// (إضافة confirmationStatus + أولويته داخل evaluateTrigger) قبل استخدام هذا الملف.
// راجع README-signal-normalizer-patch.md بنفس المجلد.

import type { SelectedOptionContract } from "./select-option-contract";
import type { BuildTriggerDataResult } from "./build-trigger-data";
import type { RawOptionData, TriggerData } from "./signal-normalizer";

// ---------- daysToExpiration ----------

/**
 * فرق تقويمي بالأيام بين تاريخ الاستحقاق وتاريخ التقييم، بحساب منتصف ليل UTC.
 * يوم الاستحقاق نفسه = 0DTE بغض النظر عن وقت اليوم الحالي.
 * الحد الأدنى = 0 (لا نرجع رقم سالب بعد انتهاء العقد).
 */
export function calculateDaysToExpiration(
  expiration: string,
  evaluatedAt: Date,
): number {
  const expirationUtc = Date.parse(`${expiration}T00:00:00.000Z`);

  const evaluatedUtc = Date.UTC(
    evaluatedAt.getUTCFullYear(),
    evaluatedAt.getUTCMonth(),
    evaluatedAt.getUTCDate(),
  );

  return Math.max(0, Math.floor((expirationUtc - evaluatedUtc) / 86_400_000));
}

// ---------- SelectedOptionContract → RawOptionData ----------

export function toRawOptionData(
  selected: SelectedOptionContract,
  underlyingPrice: number,
  evaluatedAt: Date,
): RawOptionData {
  return {
    // رمز العقد المحدد، وليس رمز الأصل الأساسي (الأصل موجود بـ stock.symbol)
    symbol: selected.contractSymbol,
    strike: selected.strike,
    optionType: selected.direction,
    expiration: selected.expiration,

    bid: selected.bid,
    ask: selected.ask,
    last: selected.last,

    delta: selected.delta,
    gamma: selected.gamma,
    theta: selected.theta,
    impliedVolatility: selected.impliedVolatility,

    volume: selected.volume,
    openInterest: selected.openInterest,

    underlyingPrice,
    daysToExpiration: calculateDaysToExpiration(
      selected.expiration,
      evaluatedAt,
    ),
  };
}

// ---------- BuildTriggerDataResult (READY) → TriggerData ----------

// نوع مساعد: حالة READY فقط، حتى لا نستقبل بالخطأ WAIT_DATA بهذي الدالة
// (يجب فلترتها قبل الاستدعاء داخل autoAnalyzeTrade)
export type ReadyBuildTriggerData = Extract<
  BuildTriggerDataResult,
  { status: "READY" }
>;

export function toEngineTriggerData(
  triggerData: ReadyBuildTriggerData,
): TriggerData {
  const { stock, triggerPlan, latestCandle, confirmation } = triggerData;

  const confirmationStatus: NonNullable<TriggerData["confirmationStatus"]> =
    confirmation.state === "CANDLE_CONFIRMED"
      ? "CONFIRMED"
      : confirmation.state === "CANCELLED"
        ? "FAILED"
        : "WAITING";

  // ⚠️ fallback مقصود: لو ما فيه شمعة مؤكدة/مجلوبة، نستخدم السعر اللحظي
  // كبديل معقول بدل null أو رقم مخترع — لكنه ليس "إغلاق شمعة" فعليًا بهذي الحالة.
  const candleClose =
    confirmation.confirmedCandle?.close ??
    latestCandle?.close ??
    stock.price;

  return {
    direction: triggerPlan.direction,

    // تعديل توافقي: أولوية مطلقة داخل evaluateTrigger() لمسار AUTO
    confirmationStatus,

    candleClose,
    // لا نملك شمعة سابقة من getLatestCompletedFiveMinuteCandle() — لا نخترعها
    previousCandleClose: null,

    breakoutLevel:
      triggerPlan.direction === "CALL" ? triggerPlan.triggerPrice : null,
    breakdownLevel:
      triggerPlan.direction === "PUT" ? triggerPlan.triggerPrice : null,

    priceAboveVwap:
      stock.vwap == null ? undefined : stock.price > stock.vwap,
    priceBelowVwap:
      stock.vwap == null ? undefined : stock.price < stock.vwap,

    relativeVolume: stock.relativeVolume ?? null,
  };
}
