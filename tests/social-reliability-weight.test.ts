import assert from "node:assert/strict";
import test from "node:test";
import type { TradeEngineReport } from "../lib/trading/trade-engine";
import {
  applySocialIntelligenceToTradeReport,
  getAverageReliability,
  getReliabilitySummary,
  normalizeReliability,
  qualifiesForForcedWait,
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

// 3. خبر BREAKING متعارض بموثوقية 0.6 يخفض الثقة فقط ولا يفرض WAIT.
test(
  "0.6 reliability BREAKING conflict lowers confidence without forcing WAIT",
  async () => {
    const report = buildFakeReport({
      decision: "BUY_CALL",
      confidence: 70,
    });

    const conflictingSignal = signal(0.6, {
      market_impact: "HIGH",
      content_type: "BREAKING",
      sentiment: "bearish",
    });

    const result = await applySocialIntelligenceToTradeReport(
      report,
      { minutes: 1440, limit: 50 },
      { loadSignals: fakeSignalLoader([conflictingSignal]) }
    );

    assert.equal(result.socialIntelligence.confidenceAdjustment, -6);
    assert.equal(result.confidence, 64);
    assert.equal(result.socialIntelligence.conflict, true);
    assert.equal(result.socialIntelligence.forcedWait, false);
    assert.equal(result.decision, "BUY_CALL");
    assert.ok(
      result.reasons.some((reason) => reason.includes("6%")),
      "reason text should reflect the actual weighted 6% adjustment"
    );
  }
);

// 4. حدث معلق منخفض الموثوقية يخفض الثقة فقط ولا يفرض WAIT.
test(
  "a low-reliability pending event lowers confidence without forcing WAIT",
  async () => {
    const report = buildFakeReport({
      decision: "BUY_CALL",
      confidence: 70,
    });

    const pendingSignal = signal(0.05, {
      market_impact: "HIGH",
      content_type: "EARNINGS",
      sentiment: null,
    });

    const result = await applySocialIntelligenceToTradeReport(
      report,
      { minutes: 1440, limit: 50 },
      { loadSignals: fakeSignalLoader([pendingSignal]) }
    );

    assert.equal(result.socialIntelligence.confidenceAdjustment, -1);
    assert.equal(result.confidence, 69);
    assert.equal(result.socialIntelligence.forcedWait, false);
    assert.equal(result.decision, "BUY_CALL");
  }
);

// 5. غياب reliability_score يستخدم 0.5 في حسابات الوزن فقط.
test("missing reliability_score defaults to 0.5", () => {
  assert.equal(normalizeReliability(undefined), 0.5);
  assert.equal(normalizeReliability(null), 0.5);
  assert.equal(getAverageReliability([signal(undefined)]), 0.5);
});

// 6. القيم فوق 1 أو تحت 0 تُحصر داخل النطاق.
test("out-of-range reliability values are clamped to [0, 1]", () => {
  assert.equal(normalizeReliability(1.4), 1);
  assert.equal(normalizeReliability(-0.3), 0);
  assert.equal(normalizeReliability(Number.NaN), 0.5);
});

// 7. عدة مصادر تستخدم المتوسط.
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

// 8. لا إشارات تعطي تعديل 0 والقرار والثقة لا يتغيران.
test(
  "no signals produce a zero adjustment and leave the report unchanged",
  async () => {
    assert.equal(getAverageReliability([]), 0);

    const summary = getReliabilitySummary([]);
    assert.deepEqual(summary, {
      averageReliability: 0,
      minimumReliability: 0,
      maximumReliability: 0,
      weightedSignalsCount: 0,
    });

    const report = buildFakeReport({
      decision: "BUY_CALL",
      confidence: 70,
    });

    const result = await applySocialIntelligenceToTradeReport(
      report,
      { minutes: 1440, limit: 50 },
      { loadSignals: fakeSignalLoader([]) }
    );

    assert.equal(result.socialIntelligence.confidenceAdjustment, 0);
    assert.equal(result.confidence, 70);
    assert.equal(result.decision, "BUY_CALL");
    assert.equal(result.socialIntelligence.forcedWait, false);
  }
);

// 9. توافق موثوقية جزئية يضيف المقدار الموزون فعليًا على الثقة.
test(
  "aligned high-impact event adds the weighted amount to confidence",
  async () => {
    const report = buildFakeReport({
      decision: "BUY_CALL",
      confidence: 70,
    });

    const alignedSignal = signal(0.6, {
      market_impact: "HIGH",
      content_type: "BREAKING",
      sentiment: "bullish",
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
  }
);

// 10. الحد الأدنى: 0.79 لا يفرض WAIT.
test("reliability 0.79 does not qualify for forced WAIT", () => {
  assert.equal(
    qualifiesForForcedWait(
      signal(0.79, {
        market_impact: "HIGH",
        content_type: "FED",
        sentiment: "neutral",
      })
    ),
    false
  );
});

// 11. الحد الأدنى: 0.80 مع HIGH وFED يفرض WAIT.
test(
  "reliability 0.80 with HIGH critical event qualifies for forced WAIT",
  async () => {
    const criticalSignal = signal(0.8, {
      market_impact: "HIGH",
      content_type: "FED",
      sentiment: "neutral",
    });

    assert.equal(qualifiesForForcedWait(criticalSignal), true);

    const result = await applySocialIntelligenceToTradeReport(
      buildFakeReport({
        decision: "BUY_CALL",
        confidence: 70,
      }),
      { minutes: 1440, limit: 50 },
      { loadSignals: fakeSignalLoader([criticalSignal]) }
    );

    assert.equal(result.socialIntelligence.forcedWait, true);
    assert.equal(result.decision, "WAIT");
  }
);

// 12. نوع حرج وموثوقية 0.80 لكن التأثير MEDIUM لا يفرض WAIT.
test(
  "reliability 0.80 critical type with MEDIUM impact does not force WAIT",
  () => {
    const mediumImpactSignal = signal(0.8, {
      market_impact: "MEDIUM",
      content_type: "EARNINGS",
      sentiment: "neutral",
    });

    assert.equal(
      qualifiesForForcedWait(mediumImpactSignal),
      false
    );
  }
);

// 13. غياب reliability_score لا يسمح بالتجميد.
test("missing reliability never qualifies for forced WAIT", async () => {
  const missingReliabilitySignal = signal(undefined, {
    market_impact: "HIGH",
    content_type: "FED",
    sentiment: "neutral",
  });

  assert.equal(
    qualifiesForForcedWait(missingReliabilitySignal),
    false
  );

  const result = await applySocialIntelligenceToTradeReport(
    buildFakeReport({
      decision: "BUY_CALL",
      confidence: 70,
    }),
    { minutes: 1440, limit: 50 },
    {
      loadSignals: fakeSignalLoader([
        missingReliabilitySignal,
      ]),
    }
  );

  assert.equal(result.socialIntelligence.forcedWait, false);
  assert.equal(result.decision, "BUY_CALL");
});

// 14. WHALE وSIGNAL لا يفرضان WAIT حتى مع موثوقية كاملة.
test(
  "high-reliability WHALE or SIGNAL never qualifies for forced WAIT",
  () => {
    for (const contentType of ["WHALE", "SIGNAL"]) {
      assert.equal(
        qualifiesForForcedWait(
          signal(1, {
            market_impact: "HIGH",
            content_type: contentType,
            sentiment: "bearish",
          })
        ),
        false
      );
    }
  }
);

// 15. الذكاء الاجتماعي لا يحول WAIT الفني إلى READY.
test("social intelligence cannot turn an existing WAIT into READY", async () => {
  const supportiveSignal = signal(1, {
    market_impact: "HIGH",
    content_type: "BREAKING",
    sentiment: "bullish",
  });

  const result = await applySocialIntelligenceToTradeReport(
    buildFakeReport({
      decision: "WAIT",
      confidence: 60,
    }),
    { minutes: 1440, limit: 50 },
    { loadSignals: fakeSignalLoader([supportiveSignal]) }
  );

  assert.equal(result.decision, "WAIT");
  assert.equal(result.socialIntelligence.forcedWait, false);
});

// 16. رفض العقد لا يتحول إلى WAIT حتى عند حدث حرج مؤهل.
test(
  "REJECT_CONTRACT is preserved during a qualifying critical hold",
  async () => {
    const criticalSignal = signal(1, {
      market_impact: "HIGH",
      content_type: "FED",
      sentiment: "neutral",
    });

    const result = await applySocialIntelligenceToTradeReport(
      buildFakeReport({
        decision: "REJECT_CONTRACT",
        confidence: 40,
      }),
      { minutes: 1440, limit: 50 },
      { loadSignals: fakeSignalLoader([criticalSignal]) }
    );

    assert.equal(result.socialIntelligence.forcedWait, true);
    assert.equal(result.decision, "REJECT_CONTRACT");
  }
);