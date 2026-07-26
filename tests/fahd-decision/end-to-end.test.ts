/**
 * end-to-end.test.ts
 * سيناريوهات كاملة تجمع كل الطبقات معاً:
 * economic-calendar-gate -> filterFreshHeadlines -> classifyNews ->
 * applyNewsModifier (مع مواءمة الاتجاه) -> final-trade-decision
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEconomicGate, type RawEconomicEvent } from "../../lib/trading/fahd-decision/economic-calendar-gate";
import { applyNewsModifier } from "../../lib/trading/fahd-decision/apply-news-modifier";
import { determineFinalTradeDecision } from "../../lib/trading/fahd-decision/final-trade-decision";
import { classifyNews, type ClassifyFn } from "../../lib/trading/fahd-decision/news-classifier";
import { filterFreshHeadlines } from "../../lib/trading/fahd-decision/normalize-news-headlines";
import type { RawHeadline } from "../../lib/trading/fahd-decision/news-modifier-types";

const NOW = new Date("2026-07-25T14:00:00.000Z").getTime();
const BASE_FINAL_SCORE = 74;

function minutesAgo(mins: number): string {
  return new Date(NOW - mins * 60_000).toISOString();
}

const noBlockingEvents: RawEconomicEvent[] = [
  { name: "Building Permits", impact: "low", startsAt: new Date(NOW + 5 * 60_000).toISOString() },
];

test("السيناريو 1: صفقة CALL مؤهلة (74) + خبر سلبي يخفضها لـ66 => REJECTED_BY_NEWS", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });
  assert.equal(economicGate.blockNewTrades, false);

  const negativeClassifyFn: ClassifyFn = async () =>
    JSON.stringify({
      sentiment: "NEGATIVE",
      confidence: 0.85,
      scoreAdjustment: -8,
      warnings: ["تقرير أرباح مخيب لسهم مرتبط بمكونات SPX الرئيسية."],
    });

  const headlines: RawHeadline[] = [
    { title: "Major SPX component misses earnings badly", publishedAt: minutesAgo(5) },
  ];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, negativeClassifyFn);

  const newsApplication = applyNewsModifier(
    BASE_FINAL_SCORE,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
      headlineHash: "hash-negative",
    },
    { positionSide: "CALL" },
  );

  assert.equal(newsApplication.adjustedFinalScore, 66);
  assert.equal(newsApplication.eligibleAfterNews, false);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "COMPLETED",
    newsApplication,
  });

  assert.equal(finalDecision, "REJECTED_BY_NEWS");
});

test("السيناريو 2: صفقة CALL مؤهلة + خبر إيجابي +4 => 78 => READY", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });

  const positiveClassifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.8, scoreAdjustment: 4, warnings: [] });

  const headlines: RawHeadline[] = [
    { title: "Broad market breadth improves ahead of open", publishedAt: minutesAgo(3) },
  ];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, positiveClassifyFn);

  const newsApplication = applyNewsModifier(
    BASE_FINAL_SCORE,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
      headlineHash: "hash-positive",
    },
    { positionSide: "CALL" },
  );

  assert.equal(newsApplication.adjustedFinalScore, 78);
  assert.equal(newsApplication.eligibleAfterNews, true);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "COMPLETED",
    newsApplication,
  });

  assert.equal(finalDecision, "READY");
});

test("السيناريو 3 (الأهم): نفس الخبر الإيجابي، لكن صفقة PUT => يضعفها بدل ينقذها => REJECTED_BY_NEWS", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });

  const positiveClassifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.85, scoreAdjustment: 4, warnings: [] });

  const headlines: RawHeadline[] = [
    { title: "Broad market breadth improves ahead of open", publishedAt: minutesAgo(3) },
  ];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, positiveClassifyFn);
  assert.equal(judgment.scoreAdjustment, 4);

  const newsApplication = applyNewsModifier(
    74,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
      headlineHash: "hash-put-positive",
    },
    { positionSide: "PUT" },
  );

  assert.equal(newsApplication.appliedAdjustment, -4);
  assert.equal(newsApplication.adjustedFinalScore, 70);
  assert.equal(newsApplication.eligibleAfterNews, false);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "COMPLETED",
    newsApplication,
  });

  assert.equal(finalDecision, "REJECTED_BY_NEWS");
});

test("السيناريو 4: خبر سلبي على السهم + صفقة PUT => يحسّنها (اتجاه صحيح)، تبقى READY", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });

  const negativeClassifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.8, scoreAdjustment: -4, warnings: [] });

  const headlines: RawHeadline[] = [{ title: "Weak guidance drags index lower", publishedAt: minutesAgo(4) }];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, negativeClassifyFn);

  const newsApplication = applyNewsModifier(
    74,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
      headlineHash: "hash-put-negative",
    },
    { positionSide: "PUT" },
  );

  assert.equal(newsApplication.appliedAdjustment, 4);
  assert.equal(newsApplication.adjustedFinalScore, 78);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "COMPLETED",
    newsApplication,
  });

  assert.equal(finalDecision, "READY");
});

test("السيناريو 5: حدث اقتصادي يمنع => BLOCKED_ECONOMIC_EVENT حتى مع خبر إيجابي على صفقة CALL", async () => {
  const blockingEvents: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: new Date(NOW + 5 * 60_000).toISOString() },
  ];
  const economicGate = evaluateEconomicGate(blockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });
  assert.equal(economicGate.blockNewTrades, true);

  const positiveClassifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "POSITIVE", confidence: 0.9, scoreAdjustment: 4, warnings: [] });

  const headlines: RawHeadline[] = [{ title: "Strong bullish momentum into the close", publishedAt: minutesAgo(2) }];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, positiveClassifyFn);

  const newsApplication = applyNewsModifier(
    BASE_FINAL_SCORE,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
      headlineHash: "hash-blocked",
    },
    { positionSide: "CALL" },
  );

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "COMPLETED",
    newsApplication,
  });

  assert.equal(finalDecision, "BLOCKED_ECONOMIC_EVENT");
});

test("السيناريو 6: فشل مصنّف الأخبار فعلياً (استثناء) على عقد CALL مؤهل => يبقى READY", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });

  const throwingClassifyFn: ClassifyFn = async () => {
    throw new Error("Claude request timed out");
  };

  const headlines: RawHeadline[] = [
    { title: "Ambiguous headline about rate speculation", publishedAt: minutesAgo(1) },
  ];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, throwingClassifyFn);
  assert.equal(judgment.sentiment, "NEUTRAL");
  assert.equal(judgment.scoreAdjustment, 0);

  const newsApplication = applyNewsModifier(
    BASE_FINAL_SCORE,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
      headlineHash: "hash-failure",
    },
    { positionSide: "CALL" },
  );

  assert.equal(newsApplication.adjustedFinalScore, BASE_FINAL_SCORE);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "FAILED_SAFE",
    newsApplication,
  });

  assert.equal(finalDecision, "READY");
});

test("السيناريو 7: كل العناوين قديمة (>30 دقيقة) => المصنّف لا يُستدعى => fallback محايد => READY", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });

  let classifyFnCalled = false;
  const shouldNeverBeCalled: ClassifyFn = async () => {
    classifyFnCalled = true;
    return JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.9, scoreAdjustment: -8, warnings: [] });
  };

  const staleHeadlines: RawHeadline[] = [
    { title: "Old news from an hour ago", publishedAt: minutesAgo(90) },
    { title: "Even older headline", publishedAt: minutesAgo(120) },
  ];
  const { fresh, staleCount } = filterFreshHeadlines(staleHeadlines, NOW);
  assert.equal(fresh.length, 0);
  assert.equal(staleCount, 2);

  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, shouldNeverBeCalled);
  assert.equal(classifyFnCalled, false, "لا يجب استدعاء المصنّف إطلاقاً — كل العناوين قديمة");
  assert.equal(judgment.sentiment, "NEUTRAL");

  const newsApplication = applyNewsModifier(
    BASE_FINAL_SCORE,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
      headlineHash: "hash-stale",
    },
    { positionSide: "CALL" },
  );
  assert.equal(newsApplication.adjustedFinalScore, BASE_FINAL_SCORE);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "FAILED_SAFE",
    newsApplication,
  });

  assert.equal(finalDecision, "READY");
});

test("السيناريو 8: ثقة منخفضة جداً (0.05) رغم تعديل قوي (-8) => لا تأثير فعلي => READY", async () => {
  const economicGate = evaluateEconomicGate(noBlockingEvents, NOW, {
    dataStatus: "AVAILABLE",
    hasOpenPosition: false,
  });

  const lowConfidenceClassifyFn: ClassifyFn = async () =>
    JSON.stringify({ sentiment: "NEGATIVE", confidence: 0.05, scoreAdjustment: -8, warnings: [] });

  const headlines: RawHeadline[] = [
    { title: "Vague rumor about possible slowdown", publishedAt: minutesAgo(2) },
  ];
  const { fresh } = filterFreshHeadlines(headlines, NOW);
  const judgment = await classifyNews({ symbol: "SPXW", headlines: fresh }, lowConfidenceClassifyFn);
  assert.equal(judgment.scoreAdjustment, 0);

  const newsApplication = applyNewsModifier(
    BASE_FINAL_SCORE,
    {
      ...judgment,
      classifiedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
      headlineHash: "hash-lowconf",
    },
    { positionSide: "CALL" },
  );
  assert.equal(newsApplication.adjustedFinalScore, BASE_FINAL_SCORE);

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "COMPLETED",
    newsApplication,
  });

  assert.equal(finalDecision, "READY");
});

test("السيناريو 9: بيانات التقويم الاقتصادي غير متاحة (UNAVAILABLE) => WAIT_DATA حتى مع كل شيء آخر جاهزاً", async () => {
  const economicGate = evaluateEconomicGate([], NOW, {
    dataStatus: "UNAVAILABLE",
    hasOpenPosition: false,
  });
  assert.equal(economicGate.blockNewTrades, false);
  assert.equal(economicGate.level, "CAUTION");

  const finalDecision = determineFinalTradeDecision({
    scanStatus: "OPPORTUNITIES_FOUND",
    economicGate,
    triggerDataIsFresh: true,
    candleState: "CANDLE_CONFIRMED",
    triggerBuilt: true,
    newsEvaluationStatus: "NOT_REQUIRED",
    newsApplication: null,
  });

  assert.equal(finalDecision, "WAIT_DATA");
});
