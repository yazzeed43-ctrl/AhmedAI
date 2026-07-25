import {
  scanSpxwOpportunitiesV3,
  getRealSpxPriceSnapshot,
} from "./spxw-scanner-v3";
import { canBuildSpxwTriggerFromQuote } from "./spx-price-freshness";

type TriggerState =
  | "PRICE_TRIGGERED"
  | "WAIT_TRIGGER"
  | "WAIT_FRESH_PRICE"
  | "CANCELLED"
  | "NO_OPPORTUNITY";

type SpxwScanResult = Awaited<ReturnType<typeof scanSpxwOpportunitiesV3>>;

export interface SpxwTriggerConfig {
  maxResults?: number;
  confirmationBufferPoints?: number;
  stopBufferPoints?: number;
  target1Points?: number;
  target2Points?: number;
  // لو المتصل عنده نتيجة scan جاهزة (مثلاً استدعى scanSpxwOpportunitiesV3
  // بنفسه قبل شوي)، يمررها هنا فتتجنب الدالة سكان داخلي إضافي مكرر.
  // لو ما انمرر، السلوك القديم يبقى كما هو (سكان داخلي تلقائي).
  precomputedScan?: SpxwScanResult;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// دالة نقية مستقلة عن أي جلب بيانات — تاخذ خطة محفوظة مسبقًا (triggerPrice
// وinvalidationPrice ثابتين من لحظة البناء) وسعر SPX حي جديد، وترجع الحالة.
// هذا يفصل "بناء الخطة" عن "فحصها لاحقًا" فعليًا: مفيدة لاستدعاء مستقل
// بعد دقائق/ساعات من البناء، بدون ما تعيد حساب triggerPrice من سعر جديد
// (لو أعدنا حسابه، الهدف يتحرك مع كل فحص بدل ما يثبت).
export function checkSpxwTriggerPlan(
  plan: {
    direction: "CALL" | "PUT";
    triggerPrice: number;
    invalidationPrice: number;
  },
  currentSpxPrice: number,
): TriggerState {
  const triggered =
    plan.direction === "CALL"
      ? currentSpxPrice >= plan.triggerPrice
      : currentSpxPrice <= plan.triggerPrice;

  const cancelled =
    plan.direction === "CALL"
      ? currentSpxPrice <= plan.invalidationPrice
      : currentSpxPrice >= plan.invalidationPrice;

  // ملاحظة مهمة: "PRICE_TRIGGERED" يعني السعر اللحظي لمس/كسر المستوى فقط —
  // مو تأكيد إغلاق شمعة 5 دقائق. تأكيد الشمعة شرط منفصل لازم يتحقق منه
  // بمكان ثاني (يدويًا أو بمنطق شموع مستقبلي) قبل الدخول الفعلي.
  return cancelled
    ? "CANCELLED"
    : triggered
      ? "PRICE_TRIGGERED"
      : "WAIT_TRIGGER";
}

export async function buildSpxwTriggerPlan(config: SpxwTriggerConfig = {}) {
  const scan =
    config.precomputedScan ??
    (await scanSpxwOpportunitiesV3({
      maxResults: config.maxResults ?? 2,
    }));

  if (scan.status !== "OPPORTUNITIES_FOUND" || !scan.opportunities.length) {
    const message =
      scan.status === "DATA_PROVIDER_ERROR"
        ? "تعذر بناء خطة SPXW لأن بيانات المسح غير مكتملة."
        : scan.status === "PARTIAL_DATA"
          ? "لم تُبنَ خطة SPXW لأن نتائج المسح جزئية وللتشخيص فقط."
          : "لا توجد فرصة SPXW مطابقة للشروط الآن.";

    return {
      generatedAt: new Date().toISOString(),
      state: "NO_OPPORTUNITY" as TriggerState,
      scan,
      plans: [],
      message,
    };
  }

  const referenceSpxPrice = scan.underlyingPrice;

  if (
    typeof referenceSpxPrice !== "number" ||
    !Number.isFinite(referenceSpxPrice)
  ) {
    throw new Error("تعذر تحديد سعر SPX لبناء خطة الدخول.");
  }

  if (!canBuildSpxwTriggerFromQuote(scan.underlyingQuote)) {
    return {
      generatedAt: new Date().toISOString(),
      state: "WAIT_FRESH_PRICE" as TriggerState,
      scan,
      plans: [],
      preparationOpportunities: scan.opportunities,
      priceFreshness: scan.underlyingQuote ?? null,
      message:
        "بيانات SPX غير لحظية حاليًا؛ أُبقيت الفرص للتحضير فقط ولم يتم بناء Trigger دخول.",
    };
  }

  // سعر حي منفصل عن لحظة الفحص (scan)، عشان currentTriggered/cancelled
  // تقارن ضد سعر جديد فعليًا، مو ضد نفس السعر اللي حُسب منه triggerPrice.
  // نفس دالة السعر الحقيقي المعتمدة بمسار SPXW (بدون بروكسي SPY).
  const currentSpxQuote = await getRealSpxPriceSnapshot();

  if (!canBuildSpxwTriggerFromQuote(currentSpxQuote)) {
    return {
      generatedAt: new Date().toISOString(),
      state: "WAIT_FRESH_PRICE" as TriggerState,
      scan,
      plans: [],
      preparationOpportunities: scan.opportunities,
      priceFreshness: currentSpxQuote,
      message:
        "تعذر التحقق من Trigger بسعر SPX لحظي؛ أُبقيت الفرص للتحضير فقط دون توصية دخول.",
    };
  }

  const currentSpxPrice = currentSpxQuote.price;

  const confirmationBuffer = config.confirmationBufferPoints ?? 1.5;
  const stopBuffer = config.stopBufferPoints ?? 6;
  const target1 = config.target1Points ?? 8;
  const target2 = config.target2Points ?? 15;

  const market = scan.market;

  const plans = scan.opportunities.map((opportunity) => {
    const isCall = opportunity.direction === "CALL";

    const triggerPrice = isCall
      ? referenceSpxPrice + confirmationBuffer
      : referenceSpxPrice - confirmationBuffer;

    const invalidationPrice = isCall
      ? triggerPrice - stopBuffer
      : triggerPrice + stopBuffer;

    const target1Price = isCall
      ? triggerPrice + target1
      : triggerPrice - target1;

    const target2Price = isCall
      ? triggerPrice + target2
      : triggerPrice - target2;

    const state = checkSpxwTriggerPlan(
      {
        direction: opportunity.direction,
        triggerPrice,
        invalidationPrice,
      },
      currentSpxPrice,
    );

    const riskPoints = Math.abs(triggerPrice - invalidationPrice);
    const reward1Points = Math.abs(target1Price - triggerPrice);
    const reward2Points = Math.abs(target2Price - triggerPrice);

    return {
      rank: opportunity.rank,
      contractSymbol: opportunity.contractSymbol,
      direction: opportunity.direction,
      strike: opportunity.strike,
      expiration: opportunity.expiration,
      midpoint: opportunity.midpoint,
      finalScore: opportunity.finalScore,
      marketBias: opportunity.marketBias,
      marketScore: opportunity.marketScore,
      state,
      // مو نفس الرقم بالضرورة: reference هو سعر لحظة اكتشاف الفرصة
      // (اللي حُسبت منه مستويات trigger/invalidation/target)، وcurrent
      // هو سعر حي جديد وقت فحص التفعيل نفسه.
      referenceUnderlyingPrice: round(referenceSpxPrice),
      currentUnderlyingPrice: round(currentSpxPrice),
      triggerPrice: round(triggerPrice),
      invalidationPrice: round(invalidationPrice),
      target1Price: round(target1Price),
      target2Price: round(target2Price),
      riskPoints: round(riskPoints),
      reward1Points: round(reward1Points),
      reward2Points: round(reward2Points),
      rr1: round(reward1Points / riskPoints),
      rr2: round(reward2Points / riskPoints),
      conditions: {
        marketDecision: market.decision,
        triggerRequired: true,
        confirmation: isCall
          ? `إغلاق شمعة 5 دقائق فوق ${round(
              triggerPrice,
            )} مع بقاء SPY وQQQ فوق VAH`
          : `إغلاق شمعة 5 دقائق تحت ${round(
              triggerPrice,
            )} مع بقاء SPY وQQQ تحت VAL`,
        cancellation: isCall
          ? `إلغاء إذا عاد SPX تحت ${round(invalidationPrice)}`
          : `إلغاء إذا عاد SPX فوق ${round(invalidationPrice)}`,
      },
    };
  });

  const hasActiveTrigger = plans.some(
    (plan) => plan.state === "PRICE_TRIGGERED",
  );

  const allCancelled =
    plans.length > 0 && plans.every((plan) => plan.state === "CANCELLED");

  const overallState: TriggerState = allCancelled
    ? "CANCELLED"
    : hasActiveTrigger
      ? "PRICE_TRIGGERED"
      : "WAIT_TRIGGER";

  return {
    generatedAt: new Date().toISOString(),
    state: overallState,
    market,
    priceFreshness: currentSpxQuote,
    plans,
    message:
      overallState === "CANCELLED"
        ? "تم إلغاء فرص SPXW بعد كسر مستوى الإبطال."
        : overallState === "PRICE_TRIGGERED"
          ? "وصل SPX إلى مستوى التفعيل، وما زال تأكيد إغلاق شمعة 5 دقائق مطلوبًا."
          : "الفرص جاهزة لكنها تنتظر الوصول إلى مستوى التفعيل.",
  };
}
