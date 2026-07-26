/**
 * reevaluate-gates-at-candle-confirmation.ts
 *
 * المشكلة اللي يعالجها هذا الملف (ملاحظة يزيد الشريف رقم 3):
 * لو فهد بدأ يتابع خطة trigger من لحظة WAIT_TRIGGER إلى PRICE_TOUCHED إلى
 * WAIT_CANDLE_CLOSE إلى CANDLE_CONFIRMED، وكانت economicGate/newsModifier
 * قد حُسبا في بداية المتابعة فقط، فمن الممكن يظهر حدث اقتصادي جديد أو خبر
 * عاجل *أثناء* انتظار تأكيد الشمعة (دقائق قد تمتد) دون أن يُعاد فحصه.
 *
 * الحل: عند الوصول فعلياً لـCANDLE_CONFIRMED، route.ts يجب يعيد استدعاء
 * economicGate وnewsModifier من جديد (بيانات حية، لا القيم المحفوظة من
 * بداية المتابعة)، ثم يمرر النتائج الطازجة لـdetermineFinalTradeDecision.
 *
 * هذا الملف لا "يعرف" تفاصيل Commit 3 الداخلية (لا أملك الكود الفعلي)،
 * لذلك هو غلاف تنسيقي (orchestration wrapper) يأخذ دوال إعادة الجلب
 * كتبعيات محقونة، ويضمن الترتيب الصحيح: لا يُسمح لأي قيمة gate/news محسوبة
 * قبل CANDLE_CONFIRMED أن تُستخدم في القرار النهائي.
 */

import { determineFinalTradeDecision, type FinalTradeDecisionInput, type FinalTradeDecision } from "./final-trade-decision";

export type CandleConfirmationRefreshDeps = {
  /** يعيد جلب/حساب economicGate ببيانات حية وقت التأكيد الفعلي، لا وقت بداية المتابعة */
  refreshEconomicGate: () => Promise<FinalTradeDecisionInput["economicGate"]>;
  /** يتحقق من حداثة بيانات السعر/الحجم وقت التأكيد */
  refreshTriggerDataIsFresh: () => Promise<boolean>;
  /**
   * يعيد تقييم الأخبار من جديد وقت التأكيد. إرجاع null صراحة لو السياق
   * لا يتطلب أخبار (newsEvaluationStatus سيصير NOT_REQUIRED تلقائياً).
   */
  refreshNewsEvaluation: () => Promise<{
    status: FinalTradeDecisionInput["newsEvaluationStatus"];
    application: FinalTradeDecisionInput["newsApplication"];
  }>;
};

export type CandleConfirmationReevaluationResult = {
  decision: FinalTradeDecision;
  /** القيم الطازجة المُستخدمة فعلياً في القرار — للتسجيل/logs، وليس لإعادة الاستخدام */
  freshInputsUsed: {
    economicGate: FinalTradeDecisionInput["economicGate"];
    triggerDataIsFresh: boolean;
    newsEvaluationStatus: FinalTradeDecisionInput["newsEvaluationStatus"];
  };
  refreshErrors: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown refresh error";
}

function unavailableEconomicGate(
  reason: string,
): FinalTradeDecisionInput["economicGate"] {
  return {
    level: "CAUTION",
    blockNewTrades: true,
    warnExistingPositions: false,
    existingPositionAction: "NONE",
    dataStatus: "UNAVAILABLE",
    reason,
  };
}

/**
 * يُستدعى فقط في لحظة وصول candleState فعلياً إلى CANDLE_CONFIRMED — ليس قبلها.
 * يعيد جلب economicGate/data-freshness/news من جديد (لا يثق بأي قيمة سابقة
 * محسوبة أثناء الانتظار)، ثم يبني القرار النهائي على القيم الطازجة فقط.
 *
 * ⚠️ ملاحظة تصميم متعمدة: فشل refreshNewsEvaluation هنا يُنتج WAIT_DATA
 * (يمنع)، على عكس فشل classifyNews العادي داخل news-classifier.ts الذي
 * يُنتج NEUTRAL fallback (لا يمنع). الفرق مقصود: classifyNews قد تفشل في
 * أي طلب عادي (رد JSON تالف من Claude) وهذا وضع طبيعي متكرر، بينما فشل كامل
 * في طبقة إعادة الفحص عند CANDLE_CONFIRMED — آخر نقطة قبل تنفيذ فعلي بمال
 * حقيقي — يشير لعطل غير طبيعي في النظام نفسه، ويستاهل توقفاً احترازياً بدل
 * الاستمرار بصمت. لا تُوحِّد هذين السلوكين اعتقاداً إنهما "نفس حالة الفشل".
 */
export async function reevaluateGatesAtCandleConfirmation(
  staticContext: {
    scanStatus: string;
    triggerBuilt: boolean;
  },
  deps: CandleConfirmationRefreshDeps,
): Promise<CandleConfirmationReevaluationResult> {
  // الترتيب هنا مهم: البوابة الاقتصادية أولاً (الأرخص والأسرع)، فلا داعي
  // لإعادة تقييم الأخبار أصلاً لو البوابة صارت تمنع أثناء الانتظار.
  let economicGate: FinalTradeDecisionInput["economicGate"];
  try {
    economicGate = await deps.refreshEconomicGate();
  } catch (error) {
    const refreshError = `ECONOMIC_GATE_REFRESH_FAILED: ${errorMessage(error)}`;
    economicGate = unavailableEconomicGate(refreshError);
    return {
      decision: "WAIT_DATA",
      freshInputsUsed: {
        economicGate,
        triggerDataIsFresh: false,
        newsEvaluationStatus: "NOT_RUN",
      },
      refreshErrors: [refreshError],
    };
  }

  if (economicGate.blockNewTrades || economicGate.dataStatus !== "AVAILABLE") {
    // قرار حاسم فوري — لا داعي لإهدار وقت/تكلفة على تحديث الأخبار
    const decision = determineFinalTradeDecision({
      scanStatus: staticContext.scanStatus,
      economicGate,
      triggerDataIsFresh: true, // غير محسوب بعد، لكن لن يُستخدم لأن economicGate يحسم القرار أولاً
      candleState: "CANDLE_CONFIRMED",
      triggerBuilt: staticContext.triggerBuilt,
      newsEvaluationStatus: "NOT_RUN",
      newsApplication: null,
    });

    return {
      decision,
      freshInputsUsed: { economicGate, triggerDataIsFresh: false, newsEvaluationStatus: "NOT_RUN" },
      refreshErrors: [],
    };
  }

  let triggerDataIsFresh = false;
  try {
    triggerDataIsFresh = await deps.refreshTriggerDataIsFresh();
  } catch (error) {
    const refreshError = `TRIGGER_FRESHNESS_REFRESH_FAILED: ${errorMessage(error)}`;
    return {
      decision: "WAIT_DATA",
      freshInputsUsed: {
        economicGate,
        triggerDataIsFresh: false,
        newsEvaluationStatus: "NOT_RUN",
      },
      refreshErrors: [refreshError],
    };
  }

  if (!triggerDataIsFresh) {
    return {
      decision: "WAIT_DATA",
      freshInputsUsed: {
        economicGate,
        triggerDataIsFresh: false,
        newsEvaluationStatus: "NOT_RUN",
      },
      refreshErrors: [],
    };
  }

  let news: Awaited<ReturnType<CandleConfirmationRefreshDeps["refreshNewsEvaluation"]>>;
  try {
    news = await deps.refreshNewsEvaluation();
  } catch (error) {
    const refreshError = `NEWS_REFRESH_FAILED: ${errorMessage(error)}`;
    return {
      decision: "WAIT_DATA",
      freshInputsUsed: {
        economicGate,
        triggerDataIsFresh: true,
        newsEvaluationStatus: "NOT_RUN",
      },
      refreshErrors: [refreshError],
    };
  }

  const decision = determineFinalTradeDecision({
    scanStatus: staticContext.scanStatus,
    economicGate,
    triggerDataIsFresh,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: staticContext.triggerBuilt,
    newsEvaluationStatus: news.status,
    newsApplication: news.application,
  });

  return {
    decision,
    freshInputsUsed: { economicGate, triggerDataIsFresh, newsEvaluationStatus: news.status },
    refreshErrors: [],
  };
}
