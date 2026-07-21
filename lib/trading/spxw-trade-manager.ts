import { getTradierQuote } from "@/lib/tradier";

export type TradeManagerState =
  | "OPEN"
  | "STOP_HIT"
  | "TARGET1_HIT"
  | "TARGET2_HIT";

export interface SpxwTradeManagerInput {
  contractSymbol: string;
  direction: "CALL" | "PUT";
  entryOptionPrice: number;
  quantity?: number;
  triggerPrice: number;
  invalidationPrice: number;
  target1Price: number;
  target2Price: number;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} يجب أن يكون رقماً صحيحاً.`);
  }
}

export async function manageSpxwTrade(input: SpxwTradeManagerInput) {
  const contractSymbol = input.contractSymbol.trim().toUpperCase();

  if (!/^SPXW\d{6}[CP]\d{8}$/.test(contractSymbol)) {
    throw new Error("رمز عقد SPXW غير صحيح.");
  }

  requireFinite("سعر الدخول", input.entryOptionPrice);
  requireFinite("التفعيل", input.triggerPrice);
  requireFinite("الإلغاء", input.invalidationPrice);
  requireFinite("الهدف الأول", input.target1Price);
  requireFinite("الهدف الثاني", input.target2Price);

  if (input.entryOptionPrice <= 0) {
    throw new Error("سعر دخول العقد يجب أن يكون أكبر من صفر.");
  }

  const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));

  const [optionQuote, spxQuote] = await Promise.all([
    getTradierQuote(contractSymbol),
    getTradierQuote("SPX"),
  ]);

  const optionPrice =
    optionQuote.bid !== null && optionQuote.ask !== null
      ? (optionQuote.bid + optionQuote.ask) / 2
      : optionQuote.last ?? optionQuote.close;

  const spxPrice = spxQuote.last ?? spxQuote.close;

  if (optionPrice === null || spxPrice === null) {
    throw new Error("تعذر تحديد السعر الحالي للعقد أو SPX.");
  }

  const isCall = input.direction === "CALL";

  const stopHit = isCall
    ? spxPrice <= input.invalidationPrice
    : spxPrice >= input.invalidationPrice;

  const target2Hit = isCall
    ? spxPrice >= input.target2Price
    : spxPrice <= input.target2Price;

  const target1Hit = isCall
    ? spxPrice >= input.target1Price
    : spxPrice <= input.target1Price;

  const state: TradeManagerState = stopHit
    ? "STOP_HIT"
    : target2Hit
      ? "TARGET2_HIT"
      : target1Hit
        ? "TARGET1_HIT"
        : "OPEN";

  const pnlPerContract = (optionPrice - input.entryOptionPrice) * 100;
  const pnlTotal = pnlPerContract * quantity;
  const pnlPercent =
    ((optionPrice - input.entryOptionPrice) / input.entryOptionPrice) * 100;

  let action = "الاحتفاظ مع الالتزام بوقف الخسارة.";
  let suggestedStop = input.invalidationPrice;

  if (state === "TARGET1_HIT") {
    action =
      "تحقق الهدف الأول: انقل الوقف إلى نقطة التفعيل وفكّر في جني جزء من العقود.";
    suggestedStop = input.triggerPrice;
  } else if (state === "TARGET2_HIT") {
    action =
      "تحقق الهدف الثاني: جني الأرباح أو حماية الجزء المتبقي بوقف متحرك.";
    suggestedStop = input.target1Price;
  } else if (state === "STOP_HIT") {
    action = "تم كسر مستوى الإلغاء: الخروج حسب الخطة وعدم توسيع الوقف.";
  }

  return {
    generatedAt: new Date().toISOString(),
    state,
    contract: {
      symbol: contractSymbol,
      direction: input.direction,
      quantity,
      entryPrice: round(input.entryOptionPrice),
      currentPrice: round(optionPrice),
      bid: optionQuote.bid,
      ask: optionQuote.ask,
      last: optionQuote.last,
    },
    underlying: {
      symbol: "SPX",
      currentPrice: round(spxPrice),
      triggerPrice: round(input.triggerPrice),
      invalidationPrice: round(input.invalidationPrice),
      target1Price: round(input.target1Price),
      target2Price: round(input.target2Price),
    },
    performance: {
      pnlPerContractUsd: round(pnlPerContract),
      pnlTotalUsd: round(pnlTotal),
      pnlPercent: round(pnlPercent),
    },
    management: {
      action,
      suggestedStop: round(suggestedStop),
      note:
        "Trade Manager V1 يعمل عند الطلب ولا ينفذ بيعاً أو شراءً تلقائياً.",
    },
  };
}
