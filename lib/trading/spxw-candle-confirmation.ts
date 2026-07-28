// محوّل SPXW فوق النواة العامة (candle-confirmation-core.ts).
// الأسماء والتوقيعات هنا لم تتغيّر إطلاقًا مقارنة بالنسخة الأصلية —
// هذا الملف الآن تفويض مباشر (delegation) بدون أي منطق مكرر، حتى
// يبقى سلوك SPXW مطابقًا 100% ولا تنشأ نسختان من نفس القواعد.
import {
  evaluateCandleConfirmation,
  type CandleConfirmationEvaluation,
  type CandleConfirmationState,
  type ClosedCandle,
  type TriggerPlan,
} from "./candle-confirmation-core";

export type SpxwCandleConfirmationState = CandleConfirmationState;
export type ClosedFiveMinuteCandle = ClosedCandle;
export type FixedTriggerState = TriggerPlan;
export type { CandleConfirmationEvaluation };

export function evaluateSpxwCandleConfirmation(input: {
  plan: FixedTriggerState;
  currentSpxPrice: number;
  lastClosedCandle: ClosedFiveMinuteCandle | null;
  evaluatedAt?: Date;
}): CandleConfirmationEvaluation {
  return evaluateCandleConfirmation({
    plan: input.plan,
    currentPrice: input.currentSpxPrice,
    lastClosedCandle: input.lastClosedCandle,
    evaluatedAt: input.evaluatedAt,
  });
}
