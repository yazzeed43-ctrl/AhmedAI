// lib/trading/build-trigger-data.ts
//
// الخطوة (د): buildTriggerData()
// يجمع: fetchStockData → (existingPlan | buildStockTriggerPlan) →
//        getLatestCompletedFiveMinuteCandle → evaluateCandleConfirmation
// في كائن واحد جاهز يستهلكه autoAnalyzeTrade() بالخطوة (هـ).
//
// - لا يستدعي fetchMarketData() — هذي مسؤولية المنسق (هـ) فقط.
// - existingPlan لا يُعاد بناؤها أبداً؛ فقط تُستخدم مباشرة لحماية
//   priceTouchedAt/state من التصفير بسبب فشل مؤقت بحساب خطة جديدة لا نحتاجها.
// - existingPlan بتعارض اتجاه مع الطلب الحالي → WAIT_DATA فوري (بدل تجاهل التعارض صامتًا).
// - فشل جلب الشمعة لا يوقف المسار؛ يتحول لـ null + تحذير (مطابق لسلوك SPXW الحالي).

import {
  fetchStockData,
} from "./auto-stock-data";

import type { RawStockData } from "./signal-normalizer";

import {
  buildStockTriggerPlan,
  type StockTriggerLevels,
} from "./stock-trigger-adapter";

import {
  evaluateCandleConfirmation,
  type TriggerPlan,
  type CandleConfirmationEvaluation,
} from "./candle-confirmation-core";

import {
  getLatestCompletedFiveMinuteCandle,
  type LatestCompletedCandle,
} from "@/lib/market-indicators";

// ---------- الأنواع ----------

export type BuildTriggerDataInput = {
  symbol: string;
  direction: "CALL" | "PUT";
  evaluatedAt?: Date;
  existingPlan?: TriggerPlan;
  deps?: {
    fetchStock?: typeof fetchStockData;
    fetchLatestCandle?: typeof getLatestCompletedFiveMinuteCandle;
  };
};

export type BuildTriggerDataResult =
  | {
      status: "READY";
      stock: RawStockData;
      triggerLevels: StockTriggerLevels;
      triggerPlan: TriggerPlan;
      latestCandle: LatestCompletedCandle | null;
      confirmation: CandleConfirmationEvaluation;
      warnings: string[];
    }
  | {
      status: "WAIT_DATA";
      stage: "STOCK_DATA" | "TRIGGER_PLAN";
      reason: string;
      warnings: string[];
    };

// ---------- الدالة الرئيسية ----------

export async function buildTriggerData(
  input: BuildTriggerDataInput,
): Promise<BuildTriggerDataResult> {
  const warnings: string[] = [];
  const evaluatedAt = input.evaluatedAt ?? new Date();

  // 1) fetchStockData → WAIT_DATA يوقف فورًا
  const fetchStock = input.deps?.fetchStock ?? fetchStockData;
  const stockResult = await fetchStock(input.symbol);

  if (stockResult.status === "WAIT_DATA") {
    return {
      status: "WAIT_DATA",
      stage: "STOCK_DATA",
      reason: stockResult.reason,
      warnings,
    };
  }

  const { stock, triggerLevels } = stockResult;

  // 2) existingPlan: تحقق تطابق الاتجاه أولاً — قبل أي استخدام.
  //    لا نعيد البناء أبداً لو existingPlan موجودة ومطابقة الاتجاه.
  //    غير موجودة؟ نبني خطة جديدة، وWAIT_DATA فيها يوقف المسار.
  let triggerPlan: TriggerPlan;

  if (input.existingPlan) {
    if (input.existingPlan.direction !== input.direction) {
      return {
        status: "WAIT_DATA",
        stage: "TRIGGER_PLAN",
        reason: "اتجاه الخطة المحفوظة لا يطابق اتجاه الطلب الحالي",
        warnings,
      };
    }
    triggerPlan = input.existingPlan;
  } else {
    const planResult = buildStockTriggerPlan(input.direction, triggerLevels);

    if (planResult.status === "WAIT_DATA") {
      return {
        status: "WAIT_DATA",
        stage: "TRIGGER_PLAN",
        reason: planResult.reason,
        warnings,
      };
    }

    triggerPlan = planResult.plan;
  }

  // 3) الشمعة: فشل الجلب لا يوقف المسار، يتحول لـ null + تحذير
  const fetchLatestCandle =
    input.deps?.fetchLatestCandle ?? getLatestCompletedFiveMinuteCandle;

  const latestCandle = await fetchLatestCandle(
    input.symbol,
    evaluatedAt,
  ).catch(() => null);

  if (latestCandle === null) {
    warnings.push(
      "تعذر جلب آخر شمعة 5 دقائق مكتملة؛ لا يمكن إصدار CANDLE_CONFIRMED.",
    );
  }

  // 4) تقييم التأكيد — currentPrice من stock.price دائمًا (وليس triggerLevels.price)
  const confirmation = evaluateCandleConfirmation({
    plan: triggerPlan,
    currentPrice: stock.price,
    lastClosedCandle: latestCandle,
    evaluatedAt,
  });

  return {
    status: "READY",
    stock,
    triggerLevels,
    triggerPlan,
    latestCandle,
    confirmation,
    warnings,
  };
}
