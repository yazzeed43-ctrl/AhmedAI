import assert from "node:assert/strict";
import test from "node:test";
import type { TradeEngineReport } from "../lib/trading/trade-engine";
import {
  applySocialIntelligenceToTradeReport,
  getAverageReliability,
  getReliabilitySummary,
  normalizeReliability,
  weightedAdjustment,
  type SocialSignal,
} from "../lib/social/social-decision-context";

function signal(
  reliability: number | null | undefined,
  overrides: Partial<SocialSignal> = {}
): SocialSignal {
  return {
    reliability_score: reliability,
    published_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildFakeReport(
  overrides: Partial<TradeEngineReport> = {}
): TradeEngineReport {
  return {
    symbol: "TEST",
    contract: {
      optionType: "CALL",
      strike: 100,
      expiration: "2026-08-01",
      daysToExpiration: 5,
    },
    scores: { market: 70, stock: 70, options: 70, trade: 70 },
    optionQuality: {
      score: 70,
      label: "GOOD",
      components: {
        liquidity: 70,
        spread: 70,
        delta: 70,
        iv: 70,
        theta: 70,
        expiration: 70,
        proximity: 70,
      },
      strengths: [],
      weaknesses: [],
    },
    directions: { market: "CALL", stock: "CALL" },
    trigger: "CONFIRMED",
    alignment: true,
    decision: "BUY_CALL",
    confidence: 70,
    reasons: [],
    warnings: [],
    summary: "القرار: شراء عقد كول\nالثقة: 70%",
    ...overrides,
  };
}

// محمّل إشارات مزيّف لحقنه بدل الاتصال الحقيقي بقاعدة البيانات، يتيح
// اختبار applySocialIntelligenceToTradeReport من طرف لطرف.
function fakeSignalLoader(symbolSignals: SocialSignal[]) {
  return async () => ({
    symbolSignals,
    marketSignals: [],
    allSignals: symbolSignals,
  });
}

// 1. توافق عالي الموثوقية يعطي +5
test("full-reliability alignment keeps the full +5 base adjustment", () => {
  const reliability = getAverageReliability([signal(1.0)]);
  assert.equal(reliability, 1.0);
  assert.equal(weightedAdjustment(5, reliability), 5);
});

// 2. توافق موثوقية 0.6 يعطي +3
test("0.6 reliability alignment scales +5 down to +3", () => {
  const reliability = getAverageReliability([signal(0.6)]);
  assert.equal(reliability, 0.6);
  assert.equal(weightedAdjustment(5, reliability), 3);
});

// 3. تعارض موثوقية 0.6 يعطي -6 مع بقاء forcedWait/conflict وقلب القرار
// إلى WAIT فعليًا — اختبار تكامل حقيقي عبر حقن الإشارات، وليس حساب
// دالة الوزن وحدها.
test("0.6 reliability conflict scales -10 to -6 and still forces WAIT", async () => {
  const report = buildFakeReport({
    decision: "BUY_CALL",
    confidence: 70,
  });

  const conflictingSignal = signal(0.6, {
    market_impact: "HIGH",
    content_type: "BREAKING",
    sentiment: "bearish", // يعاكس اتجاه صفقة CALL
  });

  const result = await applySocialIntelligenceToTradeReport(
    report,
    { minutes: 1440, limit: 50 },
    { loadSignals: fakeSignalLoader([conflictingSignal]) }
  );

  assert.equal(result.socialIntelligence.confidenceAdjustment, -6);
  assert.equal(result.confidence, 64); // 70 - 6
  assert.equal(result.socialIntelligence.conflict, true);
  assert.equal(result.socialIntelligence.forcedWait, true);
  assert.equal(result.decision, "WAIT");
  assert.ok(
    result.reasons.some((reason) => reason.includes("6%")),
    "reason text should reflect the actual weighted 6% adjustment"
  );
});

// 4. حدث معلق موثوقية منخفضة يظل يفرض WAIT — اختبار تكامل حقيقي:
// forcedWait يبقى true بصرف النظر عن ضعف الموثوقية، والقرار يتحول
// فعليًا إلى WAIT، حتى لو مقدار خفض الثقة صغير (موثوقية 0.05 → -1%).
test("a low-reliability pending event still forces WAIT on the actual report", async () => {
  const report = buildFakeReport({
    decision: "BUY_CALL",
    confidence: 70,
  });

  const pendingSignal = signal(0.05, {
    market_impact: "HIGH",
    content_type: "EARNINGS",
    sentiment: null, // بلا اتجاه بعد = حدث معلق
  });

  const result = await applySocialIntelligenceToTradeReport(
    report,
    { minutes: 1440, limit: 50 },
    { loadSignals: fakeSignalLoader([pendingSignal]) }
  );

  assert.equal(result.socialIntelligence.confidenceAdjustment, -1);
  assert.equal(result.confidence, 69); // 70 - 1، الأثر غير معدوم رغم ضعف الموثوقية
  assert.equal(result.socialIntelligence.forcedWait, true);
  assert.equal(result.decision, "WAIT");
});

// 5. غياب reliability_score يستخدم 0.5
test("missing reliability_score defaults to 0.5", () => {
  assert.equal(normalizeReliability(undefined), 0.5);
  assert.equal(normalizeReliability(null), 0.5);
  assert.equal(getAverageReliability([signal(undefined)]), 0.5);
});

// 6. القيم فوق 1 أو تحت 0 تُحصر داخل النطاق
test("out-of-range reliability values are clamped to [0, 1]", () => {
  assert.equal(normalizeReliability(1.4), 1);
  assert.equal(normalizeReliability(-0.3), 0);
  assert.equal(normalizeReliability(Number.NaN), 0.5);
});

// 7. عدة مصادر تستخدم المتوسط
test("multiple sources use the average reliability", () => {
  const reliability = getAverageReliability([
    signal(1.0),
    signal(0.6),
    signal(0.2),
  ]);
  assert.equal(reliability, 0.6);

  const summary = getReliabilitySummary([
    signal(1.0),
    signal(0.6),
    signal(0.2),
  ]);
  assert.equal(summary.averageReliability, 0.6);
  assert.equal(summary.minimumReliability, 0.2);
  assert.equal(summary.maximumReliability, 1.0);
  assert.equal(summary.weightedSignalsCount, 3);
});

// 8. لا إشارات تعطي تعديل 0 — اختبار تكامل: القرار والثقة لا يتغيران
test("no signals produce a zero adjustment and leave the report unchanged", async () => {
  assert.equal(getAverageReliability([]), 0);

  const summary = getReliabilitySummary([]);
  assert.deepEqual(summary, {
    averageReliability: 0,
    minimumReliability: 0,
    maximumReliability: 0,
    weightedSignalsCount: 0,
  });

  const report = buildFakeReport({ decision: "BUY_CALL", confidence: 70 });

  const result = await applySocialIntelligenceToTradeReport(
    report,
    { minutes: 1440, limit: 50 },
    { loadSignals: fakeSignalLoader([]) }
  );

  assert.equal(result.socialIntelligence.confidenceAdjustment, 0);
  assert.equal(result.confidence, 70);
  assert.equal(result.decision, "BUY_CALL");
  assert.equal(result.socialIntelligence.forcedWait, false);
});

// 9. توافق موثوقية جزئية يضيف المقدار الموزون فعليًا على الثقة (تكامل)
test("aligned high-impact event adds the weighted amount to confidence", async () => {
  const report = buildFakeReport({ decision: "BUY_CALL", confidence: 70 });

  const alignedSignal = signal(0.6, {
    market_impact: "HIGH",
    content_type: "BREAKING",
    sentiment: "bullish", // يوافق اتجاه صفقة CALL
  });

  const result = await applySocialIntelligenceToTradeReport(
    report,
    { minutes: 1440, limit: 50 },
    { loadSignals: fakeSignalLoader([alignedSignal]) }
  );

  assert.equal(result.socialIntelligence.confidenceAdjustment, 3);
  assert.equal(result.confidence, 73);
  assert.equal(result.socialIntelligence.forcedWait, false);
  assert.ok(
    result.reasons.some((reason) => reason.includes("3%")),
    "reason text should reflect the actual weighted 3% adjustment"
  );
});
