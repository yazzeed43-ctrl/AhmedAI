import type { TriggerPlan } from "./candle-confirmation-core";

// محوّل الأسهم العادية: يبني triggerPrice/invalidationPrice من مستويات
// السهم المتوفرة فعليًا (VAH/VAL/POC من Volume Profile، أو support/
// resistance الاحتياطية، وVWAP). لا يخترع Swing High/Low من بيانات
// غير موجودة — لو المستويات الموثوقة ناقصة يرجع WAIT_DATA بدل خطة
// غير موثوقة. خصوصيات SPXW (اختيار العقد، مصدر السعر SPX) لا تدخل هنا.

export type StockTriggerPlanResult =
  | { status: "READY"; plan: TriggerPlan }
  | { status: "WAIT_DATA"; reason: string };

export interface StockTriggerLevels {
  price: number;
  vwap?: number | null;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  support?: number | null;
  resistance?: number | null;
}

function pickCallTriggerLevel(
  levels: StockTriggerLevels
): number | null {
  return levels.resistance ?? levels.vah ?? null;
}

function pickPutTriggerLevel(
  levels: StockTriggerLevels
): number | null {
  return levels.support ?? levels.val ?? null;
}

function pickCallInvalidationLevel(
  levels: StockTriggerLevels,
  price: number
): number | null {
  if (levels.vwap !== null && levels.vwap !== undefined) {
    return levels.vwap;
  }

  if (
    levels.poc !== null &&
    levels.poc !== undefined &&
    price > levels.poc
  ) {
    return levels.poc;
  }

  return levels.val ?? null;
}

function pickPutInvalidationLevel(
  levels: StockTriggerLevels,
  price: number
): number | null {
  if (levels.vwap !== null && levels.vwap !== undefined) {
    return levels.vwap;
  }

  if (
    levels.poc !== null &&
    levels.poc !== undefined &&
    price < levels.poc
  ) {
    return levels.poc;
  }

  return levels.vah ?? null;
}

export function buildStockTriggerPlan(
  direction: "CALL" | "PUT",
  levels: StockTriggerLevels
): StockTriggerPlanResult {
  const triggerPrice =
    direction === "CALL"
      ? pickCallTriggerLevel(levels)
      : pickPutTriggerLevel(levels);

  if (triggerPrice === null) {
    return {
      status: "WAIT_DATA",
      reason:
        direction === "CALL"
          ? "لا تتوفر مقاومة أو VAH موثوقة لبناء مستوى التفعيل"
          : "لا يتوفر دعم أو VAL موثوق لبناء مستوى التفعيل",
    };
  }

  const invalidationPrice =
    direction === "CALL"
      ? pickCallInvalidationLevel(levels, levels.price)
      : pickPutInvalidationLevel(levels, levels.price);

  if (invalidationPrice === null) {
    return {
      status: "WAIT_DATA",
      reason:
        "لا تتوفر VWAP أو POC/VAL/VAH كافية لبناء مستوى الإبطال",
    };
  }

  // فحص سلامة: مستوى التفعيل لازم يكون بالاتجاه الصحيح من مستوى
  // الإبطال، وإلا الخطة تنكسر فورًا (مثال: إبطال CALL فوق مستوى
  // التفعيل نفسه). في هالحالة الأصح WAIT_DATA وليس خطة متناقضة.
  const isConsistent =
    direction === "CALL"
      ? invalidationPrice < triggerPrice
      : invalidationPrice > triggerPrice;

  if (!isConsistent) {
    return {
      status: "WAIT_DATA",
      reason:
        "مستويات السهم الحالية متضاربة (الإبطال والتفعيل على نفس الجهة) ولا يمكن بناء خطة موثوقة",
    };
  }

  return {
    status: "READY",
    plan: {
      direction,
      triggerPrice,
      invalidationPrice,
    },
  };
}
