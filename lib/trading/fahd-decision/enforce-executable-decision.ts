/**
 * enforce-executable-decision.ts
 *
 * الطبقة الأخيرة قبل عرض أي توصية للمستخدم أو Claude داخل route.ts.
 * تفرض برمجياً: توصية قابلة للتنفيذ فقط عند READY، وأي حالة أخرى تُعرض
 * كرسالة انتظار/رفض واضحة، لا كصفقة.
 *
 * الاستخدام في route.ts (بعد determineFinalTradeDecision مباشرة):
 *
 *   const finalDecision = determineFinalTradeDecision({...});
 *   const gateResult = enforceExecutableDecision(finalDecision, { trigger, economicGate, newsApplication });
 *
 *   const output = {
 *     source: "Fahd SPXW engines",
 *     scan,
 *     trigger: gateResult.executableTrigger, // null إلا لو READY فعلاً
 *     decision: finalDecision,
 *     userMessage: gateResult.userMessage,
 *     strictRules: {
 *       ...,
 *       finalDecisionCannotBeOverridden: true,
 *     },
 *   };
 */

import type { FinalTradeDecision } from "./final-trade-decision";

const EXECUTABLE_DECISION: FinalTradeDecision = "READY";

/** رسائل عربية جاهزة للعرض لكل حالة غير قابلة للتنفيذ — لا تسريب لمنطق داخلي */
const USER_FACING_MESSAGES: Record<FinalTradeDecision, string> = {
  READY: "الفرصة جاهزة للتنفيذ.",
  BLOCKED_ECONOMIC_EVENT: "التداول موقوف مؤقتاً بسبب حدث اقتصادي عالي التأثير قريب.",
  WAIT_DATA: "البيانات غير جاهزة أو غير مؤكدة حالياً — بانتظار تحديثها.",
  NO_OPPORTUNITY: "لا توجد فرصة تستوفي شروط فهد حالياً.",
  WAIT_TRIGGER: "بانتظار وصول السعر لمنطقة التفعيل.",
  WAIT_CANDLE_CLOSE: "بانتظار تأكيد إغلاق الشمعة.",
  CANCELLED: "تم إلغاء خطة التفعيل الحالية.",
  REJECTED_BY_NEWS: "الفرصة استوفت الشروط الفنية، لكن الأخبار الحالية أسقطتها تحت الحد الأدنى.",
};

export type EnforcementResult<TTrigger> = {
  isExecutable: boolean;
  /** null دائماً إلا لو isExecutable === true — لا تسريب لخطة تنفيذ غير جاهزة */
  executableTrigger: TTrigger | null;
  userMessage: string;
  decision: FinalTradeDecision;
  invariantViolation: "READY_WITHOUT_TRIGGER" | null;
};

/**
 * يفرض القاعدة: trigger لا يخرج للمستخدم/Claude إلا عند READY بالضبط.
 * حتى لو مرّرت trigger صالحاً فنياً، أي decision غير READY يصفّره إلى null.
 */
export function enforceExecutableDecision<TTrigger>(
  decision: FinalTradeDecision,
  context: { trigger: TTrigger | null },
): EnforcementResult<TTrigger> {
  const readyWithoutTrigger =
    decision === EXECUTABLE_DECISION && context.trigger === null;
  const enforcedDecision: FinalTradeDecision = readyWithoutTrigger
    ? "WAIT_TRIGGER"
    : decision;
  const isExecutable =
    enforcedDecision === EXECUTABLE_DECISION && context.trigger !== null;
  const userMessage =
    readyWithoutTrigger
      ? "تعذر تجهيز خطة تنفيذ صالحة رغم اكتمال القرار — لم تصدر توصية دخول."
      : USER_FACING_MESSAGES[enforcedDecision];

  return {
    isExecutable,
    executableTrigger: isExecutable ? context.trigger : null,
    userMessage,
    decision: enforcedDecision,
    invariantViolation: readyWithoutTrigger ? "READY_WITHOUT_TRIGGER" : null,
  };
}
