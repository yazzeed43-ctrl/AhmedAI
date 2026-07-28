// lib/trading/auto-analyze-trade.ts
//
// الخطوة (هـ): autoAnalyzeTrade()
// المنسق الرئيسي الذي يجمع السوق، السهم، التفعيل، واختيار العقد
// في تحليل واحد جاهز، اعتمادًا حصريًا على اللبنات المُختبرة سابقًا:
//
//   fetchMarketData()        (أ)
//   buildTriggerData()       (د)
//   selectOptionContract()   (ج)
//   toRawOptionData() / toEngineTriggerData()   (د.1)
//   runTradeEngine()         (المحرك القديم، بدون تعديل منطقي)
//
// قواعد جوهرية:
// - لا يستدعي اختيار العقد أو المحرك إلا بعد CANDLE_CONFIRMED صراحة.
// - لا يخزن ولا يسترجع أي شيء من Supabase — نقي وقابل للاختبار بالكامل.
// - لا يطبّق applySocialIntelligenceToTradeReport() — هذي مسؤولية طبقة
//   API/fahd-chat بعد استلام report، مثل السلوك الحالي.
// - لا يخترع محرك قرار ثانٍ (ENTER/WAIT/SKIP) — القرار موجود أصلاً
//   داخل TradeEngineReport.decision.

import { fetchMarketData } from "./auto-market-data";
import type { RawMarketData } from "./signal-normalizer";

import { buildTriggerData } from "./build-trigger-data";
import type { TriggerPlan } from "./candle-confirmation-core";

import { selectOptionContract } from "./select-option-contract";
import type { SelectedOptionContract } from "./select-option-contract";

import {
  toRawOptionData,
  toEngineTriggerData,
  type ReadyBuildTriggerData,
} from "./auto-trade-input-adapter";

import { runTradeEngine } from "./trade-engine";
import type { TradeEngineReport } from "./trade-engine";

// ---------- الأنواع ----------

export type AutoAnalyzeTradeInput = {
  symbol: string;
  direction: "CALL" | "PUT";

  timeframe?: string;

  strike?: number;
  expiration?: string;

  existingPlan?: TriggerPlan;
  evaluatedAt?: Date;

  deps?: {
    fetchMarket?: typeof fetchMarketData;
    buildTrigger?: typeof buildTriggerData;
    selectContract?: typeof selectOptionContract;
    runEngine?: typeof runTradeEngine;
  };
};

export type AutoAnalyzeTradeResult =
  | {
      status: "WAIT_DATA";
      stage: "MARKET_DATA" | "TRIGGER_DATA" | "OPTION_CONTRACT";
      reason: string;
      marketData: RawMarketData | null;
      triggerData: ReadyBuildTriggerData | null;
      selectedContract: SelectedOptionContract | null;
      report: null;
      warnings: string[];
    }
  | {
      status: "WAIT_TRIGGER";
      marketData: RawMarketData;
      triggerData: ReadyBuildTriggerData;
      selectedContract: null;
      report: null;
      warnings: string[];
    }
  | {
      status: "COMPLETED";
      marketData: RawMarketData;
      triggerData: ReadyBuildTriggerData;
      selectedContract: SelectedOptionContract;
      report: TradeEngineReport;
      warnings: string[];
    };

// ---------- الدالة الرئيسية ----------

export async function autoAnalyzeTrade(
  input: AutoAnalyzeTradeInput,
): Promise<AutoAnalyzeTradeResult> {
  const evaluatedAt = input.evaluatedAt ?? new Date();

  const fetchMarket = input.deps?.fetchMarket ?? fetchMarketData;
  const buildTrigger = input.deps?.buildTrigger ?? buildTriggerData;
  const selectContract = input.deps?.selectContract ?? selectOptionContract;
  const runEngine = input.deps?.runEngine ?? runTradeEngine;

  // 1) جلب السوق — WAIT_DATA يوقف كل شي بعدها
  const marketResult = await fetchMarket(input.timeframe ?? "15min");

  if (marketResult.status === "WAIT_DATA") {
    return {
      status: "WAIT_DATA",
      stage: "MARKET_DATA",
      reason: marketResult.reason,
      marketData: null,
      triggerData: null,
      selectedContract: null,
      report: null,
      warnings: [],
    };
  }

  // 2) بناء التفعيل — لا نمرر fetchMarketData() هنا إطلاقًا (مسؤولية منفصلة)
  const triggerResult = await buildTrigger({
    symbol: input.symbol,
    direction: input.direction,
    existingPlan: input.existingPlan,
    evaluatedAt,
  });

  if (triggerResult.status === "WAIT_DATA") {
    return {
      status: "WAIT_DATA",
      stage: "TRIGGER_DATA",
      reason: triggerResult.reason,
      marketData: marketResult.data,
      triggerData: null,
      selectedContract: null,
      report: null,
      warnings: triggerResult.warnings,
    };
  }

  // 3) فحص حالة الشمعة — اختيار العقد وتشغيل المحرك فقط بعد CANDLE_CONFIRMED
  if (triggerResult.confirmation.state !== "CANDLE_CONFIRMED") {
    return {
      status: "WAIT_TRIGGER",
      marketData: marketResult.data,
      triggerData: triggerResult,
      selectedContract: null,
      report: null,
      warnings: triggerResult.warnings,
    };
  }

  // 4) اختيار العقد
  const contractResult = await selectContract({
    symbol: input.symbol,
    direction: input.direction,
    strike: input.strike,
    expiration: input.expiration,
  });

  if (contractResult.status === "WAIT_DATA") {
    return {
      status: "WAIT_DATA",
      stage: "OPTION_CONTRACT",
      reason: contractResult.reason,
      marketData: marketResult.data,
      triggerData: triggerResult,
      selectedContract: null,
      report: null,
      warnings: [...triggerResult.warnings, ...contractResult.warnings],
    };
  }

  // 5) بناء مدخل المحرك عبر الـ Adapter (د.1) — لا تحويل يدوي هنا
  const option = toRawOptionData(
    contractResult.contract,
    triggerResult.stock.price,
    evaluatedAt,
  );

  const trigger = toEngineTriggerData(triggerResult);

  // 6) تشغيل المحرك
  const report = runEngine({
    market: marketResult.data,
    stock: triggerResult.stock,
    option,
    trigger,
  });

  return {
    status: "COMPLETED",
    marketData: marketResult.data,
    triggerData: triggerResult,
    selectedContract: contractResult.contract,
    report,
    warnings: [...triggerResult.warnings, ...contractResult.warnings],
  };
}
