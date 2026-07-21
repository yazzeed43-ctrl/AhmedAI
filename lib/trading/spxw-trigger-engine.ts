import { scanSpxwOpportunitiesV3 } from "./spxw-scanner-v3";

type TriggerState =
  | "ENTER_NOW"
  | "WAIT_TRIGGER"
  | "CANCELLED"
  | "NO_OPPORTUNITY";

export interface SpxwTriggerConfig {
  maxResults?: number;
  confirmationBufferPoints?: number;
  stopBufferPoints?: number;
  target1Points?: number;
  target2Points?: number;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export async function buildSpxwTriggerPlan(
  config: SpxwTriggerConfig = {},
) {
  const scan = await scanSpxwOpportunitiesV3({
    maxResults: config.maxResults ?? 2,
  });

  if (!scan.opportunities.length) {
    return {
      generatedAt: new Date().toISOString(),
      state: "NO_OPPORTUNITY" as TriggerState,
      scan,
      plans: [],
      message: "لا توجد فرصة SPXW مطابقة للشروط الآن.",
    };
  }

  const confirmationBuffer = config.confirmationBufferPoints ?? 1.5;
  const stopBuffer = config.stopBufferPoints ?? 6;
  const target1 = config.target1Points ?? 8;
  const target2 = config.target2Points ?? 15;

  const spxPrice = scan.underlyingPrice;
  const market = scan.market;

  const plans = scan.opportunities.map((opportunity) => {
    const isCall = opportunity.direction === "CALL";

    const triggerPrice = isCall
      ? spxPrice + confirmationBuffer
      : spxPrice - confirmationBuffer;

    const invalidationPrice = isCall
      ? triggerPrice - stopBuffer
      : triggerPrice + stopBuffer;

    const target1Price = isCall
      ? triggerPrice + target1
      : triggerPrice - target1;

    const target2Price = isCall
      ? triggerPrice + target2
      : triggerPrice - target2;

    const currentTriggered = isCall
      ? spxPrice >= triggerPrice
      : spxPrice <= triggerPrice;

    const cancelled = isCall
      ? spxPrice <= invalidationPrice
      : spxPrice >= invalidationPrice;

    const state: TriggerState = cancelled
      ? "CANCELLED"
      : currentTriggered
        ? "ENTER_NOW"
        : "WAIT_TRIGGER";

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
      underlyingPrice: round(spxPrice),
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
        confirmation:
          isCall
            ? `إغلاق شمعة 5 دقائق فوق ${round(triggerPrice)} مع بقاء SPY وQQQ فوق VAH`
            : `إغلاق شمعة 5 دقائق تحت ${round(triggerPrice)} مع بقاء SPY وQQQ تحت VAL`,
        cancellation:
          isCall
            ? `إلغاء إذا عاد SPX تحت ${round(invalidationPrice)}`
            : `إلغاء إذا عاد SPX فوق ${round(invalidationPrice)}`,
      },
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    state: plans.some((plan) => plan.state === "ENTER_NOW")
      ? "ENTER_NOW"
      : "WAIT_TRIGGER",
    market,
    plans,
    message:
      plans.some((plan) => plan.state === "ENTER_NOW")
        ? "تم تفعيل فرصة SPXW."
        : "الفرص جاهزة لكن تنتظر إغلاق شمعة التأكيد.",
  };
}
