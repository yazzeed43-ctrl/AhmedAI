/**
 * final-trade-decision.ts (نهائي)
 *
 * يحوّل كل الحالات المتناثرة (scan/economicGate/candle/trigger/newsModifier)
 * إلى حالة واحدة صريحة، بنفس ترتيب التنفيذ المعتمد في route.ts:
 *
 *   scan -> economicGate (يمنع قبل أي شيء آخر) -> حالة بيانات البوابة نفسها
 *   -> بيانات حديثة -> حالة آلة الشمعة (مُفسَّرة صراحة) -> بناء trigger
 *   -> newsModifier -> adjustedFinalScore
 *
 * تعديلات المراجعة الثانية (يزيد الشريف):
 * - candleState يُفسَّر صراحة لكل قيمة معروفة عبر switch، بدل فحص واحد
 *   على "CANDLE_CONFIRMED" فقط — هذا كان يبتلع WAIT_TRIGGER وCANCELLED
 *   داخل WAIT_CANDLE_CLOSE بالخطأ.
 * - أُضيفت حالة CANCELLED صريحة في FinalTradeDecision.
 * - أُضيف newsEvaluationStatus إجباري — newsApplication=null لم يعد يعني
 *   تلقائياً READY. فقط NOT_REQUIRED يسمح بالاستمرار بدون newsApplication.
 * - أُضيفت NO_OPPORTUNITY منفصلة عن WAIT_DATA (لا نخلط "لا توجد فرصة"
 *   الشرعية مع "البيانات غير جاهزة").
 * - economicGate.dataStatus غير AVAILABLE (UNAVAILABLE أو PARTIAL) => WAIT_DATA،
 *   حتى لو level=CAUTION فقط (بدون BLOCK) — في نظام لحظي، "لا نعرف" = "انتظر".
 */

import type { EconomicGateDecision } from "./economic-calendar-gate";
import type { NewsModifierApplication } from "./apply-news-modifier";

export type FinalTradeDecision =
  | "BLOCKED_ECONOMIC_EVENT"
  | "WAIT_DATA"
  | "NO_OPPORTUNITY"
  | "WAIT_TRIGGER"
  | "WAIT_CANDLE_CLOSE"
  | "CANCELLED"
  | "REJECTED_BY_NEWS"
  | "READY";

/**
 * حالة تشغيل طبقة الأخبار — تُمرَّر صراحة من route.ts، ولا تُستنتَج من
 * وجود/غياب newsApplication وحده.
 */
export type NewsEvaluationStatus = "NOT_REQUIRED" | "COMPLETED" | "FAILED_SAFE" | "NOT_RUN";

/** حالات آلة شمعة الـ5 دقائق المعروفة */
export type CandleState =
  | "WAIT_TRIGGER"
  | "PRICE_TOUCHED"
  | "WAIT_CANDLE_CLOSE"
  | "CANDLE_CONFIRMED"
  | "CANCELLED";

export type FinalTradeDecisionInput = {
  scanStatus: string;
  economicGate: EconomicGateDecision;
  triggerDataIsFresh: boolean;
  candleState: string;
  triggerBuilt: boolean;
  newsEvaluationStatus: NewsEvaluationStatus;
  newsApplication: NewsModifierApplication | null;
};

const SCAN_OPPORTUNITIES_FOUND = "OPPORTUNITIES_FOUND";

/**
 * حالات "لا توجد فرصة" المعروفة من طبقة المسح — تُعامَل كنتيجة شرعية
 * (لا مشكلة بيانات)، فتُميَّز صراحة عن WAIT_DATA. أي قيمة أخرى غير معروفة
 * تُعامَل كمشكلة بيانات (WAIT_DATA) إلى أن تُضاف صراحة هنا.
 *
 * ⚠️ يجب تأكيد هذي القيم فعلياً من scanSpxwOpportunitiesV3 عند الدمج —
 * هذي قائمة افتراضية بالأسماء الشائعة، وليست مسحوبة من الكود الفعلي.
 */
const SCAN_NO_OPPORTUNITY_STATUSES = new Set(["NO_OPPORTUNITIES", "NO_MATCH", "NO_OPPORTUNITY"]);

function resolveCandleState(candleState: string): FinalTradeDecision | "PROCEED" {
  switch (candleState as CandleState) {
    case "WAIT_TRIGGER":
      return "WAIT_TRIGGER";
    case "PRICE_TOUCHED":
    case "WAIT_CANDLE_CLOSE":
      return "WAIT_CANDLE_CLOSE";
    case "CANCELLED":
      return "CANCELLED";
    case "CANDLE_CONFIRMED":
      return "PROCEED";
    default:
      return "WAIT_DATA";
  }
}

export function determineFinalTradeDecision(input: FinalTradeDecisionInput): FinalTradeDecision {
  // 1) scan — نفرّق "لا توجد فرصة" (نتيجة شرعية) عن "بيانات غير جاهزة"
  if (input.scanStatus !== SCAN_OPPORTUNITIES_FOUND) {
    if (SCAN_NO_OPPORTUNITY_STATUSES.has(input.scanStatus)) {
      if (input.economicGate.dataStatus !== "AVAILABLE") {
        return "WAIT_DATA";
      }
      return "NO_OPPORTUNITY";
    }
    return "WAIT_DATA";
  }

  // غياب/نقص بيانات التقويم يعني WAIT_DATA، لا حدثًا اقتصاديًا مؤكدًا.
  if (input.economicGate.dataStatus !== "AVAILABLE") {
    return "WAIT_DATA";
  }

  // حدث مؤكد من تقويم مكتمل يمنع قبل الأخبار أو أي فحص إضافي.
  if (input.economicGate.blockNewTrades) {
    return "BLOCKED_ECONOMIC_EVENT";
  }

  // 3) حداثة البيانات
  if (!input.triggerDataIsFresh) {
    return "WAIT_DATA";
  }

  // 4) حالة آلة الشمعة — تفسير صريح لكل قيمة، لا فحص ثنائي مبسَّط
  const candleResolution = resolveCandleState(input.candleState);
  if (candleResolution !== "PROCEED") {
    return candleResolution;
  }

  // 5) بناء trigger فعلي
  if (!input.triggerBuilt) {
    return "WAIT_TRIGGER";
  }

  // 6) newsModifier — لا نستنتج الأمان من غياب newsApplication وحده
  switch (input.newsEvaluationStatus) {
    case "NOT_RUN":
      return "WAIT_DATA";

    case "NOT_REQUIRED":
      return "READY";

    case "COMPLETED":
    case "FAILED_SAFE": {
      if (!input.newsApplication) {
        return "WAIT_DATA";
      }
      if (!input.newsApplication.eligibleAfterNews) {
        return "REJECTED_BY_NEWS";
      }
      return "READY";
    }
  }
}
