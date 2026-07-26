/**
 * economic-calendar-gate.test.ts
 * يشغَّل عبر node:test (نفس نمط المشروع)، وليس Vitest.
 *
 * تشغيل مباشر أثناء التطوير:   npx tsx --test economic-calendar-gate.test.ts
 * ضمن سير عمل المشروع الفعلي: tsc ثم node --test على الملفات المُصرَّفة (dist/**\/*.test.js)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEconomicGate, type RawEconomicEvent } from "../../lib/trading/fahd-decision/economic-calendar-gate";

const NOW = new Date("2026-07-25T14:00:00.000Z").getTime();

function minutesFromNow(mins: number): string {
  return new Date(NOW + mins * 60_000).toISOString();
}

// ============================================================
// 1) الحالات الأساسية
// ============================================================

test("لا توجد أحداث => NONE", () => {
  const result = evaluateEconomicGate([], NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "NONE");
  assert.equal(result.blockNewTrades, false);
  assert.equal(result.dataStatus, "AVAILABLE");
});

test("UNAVAILABLE => CAUTION دائماً، حتى مع وجود حدث BLOCK محتمل", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(5) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "UNAVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "CAUTION");
  assert.equal(result.blockNewTrades, true);
  assert.equal(result.dataStatus, "UNAVAILABLE");
});

// ============================================================
// 2) PARTIAL (كانت مفقودة بالكامل — أُضيفت الآن)
// ============================================================

test("PARTIAL بدون حدث نشط => CAUTION وليس NONE", () => {
  const result = evaluateEconomicGate([], NOW, { dataStatus: "PARTIAL", hasOpenPosition: false });
  assert.equal(result.level, "CAUTION");
  assert.equal(result.blockNewTrades, true);
  assert.equal(result.dataStatus, "PARTIAL");
});

test("PARTIAL مع حدث BLOCK فعلي => يبقى BLOCK (الحدث المؤكد أقوى من نقص البيانات)", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(5) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "PARTIAL", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.dataStatus, "PARTIAL");
});

// ============================================================
// 3) الحدود الزمنية الدقيقة (بالثواني، لا الدقائق الصحيحة فقط)
// ============================================================

test("FOMC قبل 15 دقيقة بالضبط (900 ثانية) => BLOCK (الحد مُدرَج)", () => {
  const startsAt = new Date(NOW + 15 * 60_000).toISOString();
  const events: RawEconomicEvent[] = [{ name: "FOMC Rate Decision", impact: "high", startsAt }];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
});

test("FOMC قبل 15 دقيقة وثانية واحدة (901 ثانية) => NONE (خارج الحد)", () => {
  const startsAt = new Date(NOW + 15 * 60_000 + 1000).toISOString();
  const events: RawEconomicEvent[] = [{ name: "FOMC Rate Decision", impact: "high", startsAt }];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "NONE");
});

test("FOMC بعد 30 دقيقة بالضبط => BLOCK (الحد مُدرَج)", () => {
  const startsAt = new Date(NOW - 30 * 60_000).toISOString();
  const events: RawEconomicEvent[] = [{ name: "FOMC Rate Decision", impact: "high", startsAt }];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
});

test("FOMC بعد 30 دقيقة وثانية واحدة => NONE (خارج الحد)", () => {
  const startsAt = new Date(NOW - (30 * 60_000 + 1000)).toISOString();
  const events: RawEconomicEvent[] = [{ name: "FOMC Rate Decision", impact: "high", startsAt }];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "NONE");
});

// ============================================================
// 4) لحظة الحدث نفسها (startsAt === NOW بالضبط)
// ============================================================

test("startsAt يساوي NOW بالضبط => يُصنَّف ضمن نافذة ما بعد الحدث، minutesSinceEvent=0، BLOCK", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: new Date(NOW).toISOString() },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.minutesSinceEvent, 0);
  assert.equal(result.activeEvent?.minutesUntilEvent, null);
});

// ============================================================
// 5) التاريخ غير الصالح — يجب ألا يتحول بصمت إلى "لا توجد أحداث" دون توثيق السبب
// ============================================================

test("تاريخ startsAt غير صالح => لا يرمي استثناء، ويُستبعد الحدث من التقييم", () => {
  const events: RawEconomicEvent[] = [{ name: "CPI", impact: "high", startsAt: "not-a-date" }];
  assert.doesNotThrow(() => {
    evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  });
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "NONE");
});

test("تاريخ غير صالح ضمن dataStatus=PARTIAL => يبقى CAUTION (رفع PARTIAL مسؤولية طبقة التطبيع في route.ts، وليس هذه الدالة)", () => {
  const events: RawEconomicEvent[] = [{ name: "CPI", impact: "high", startsAt: "not-a-date" }];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "PARTIAL", hasOpenPosition: false });
  assert.equal(result.level, "CAUTION");
  assert.equal(result.dataStatus, "PARTIAL");
});

// ============================================================
// 6) حدثان BLOCK فعليان: اختيار الأقرب زمنياً، لا الأوسع نافذة
// ============================================================

test("FOMC بعد 12 دقيقة مقابل CPI بعد دقيقتين: يُختار CPI الأقرب رغم نافذة FOMC الأوسع", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(12) },
    { name: "CPI m/m", impact: "high", startsAt: minutesFromNow(2) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.name, "CPI m/m");
});

// اختبار مُعاد التسمية ليعكس ما يحدث فعلياً (لا "BLOCK يطغى على CAUTION" لأن medium لا تُنتج CAUTION أصلاً)
test("حدث high نشط يتجاوز حدث medium متجاهَل تماماً من التقييم", () => {
  const events: RawEconomicEvent[] = [
    { name: "Minor Data Release", impact: "medium", startsAt: minutesFromNow(1) },
    { name: "CPI m/m", impact: "high", startsAt: minutesFromNow(9) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.name, "CPI m/m");
});

test("medium/low لا تُنتج أي مستوى حتى عند القرب الشديد أو تجاوز لحظة الحدث", () => {
  const events: RawEconomicEvent[] = [
    { name: "Building Permits", impact: "low", startsAt: minutesFromNow(1) },
    { name: "Housing Starts", impact: "medium", startsAt: minutesFromNow(-1) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "NONE");
});

// ============================================================
// 7) عدم تعديل المدخلات (immutability) — مع Object.freeze لضمان الفحص الفعلي
// ============================================================

test("الدالة لا تعدّل مصفوفة أو عناصر الأحداث المُمرَّرة (مضمونة عبر Object.freeze)", () => {
  const events = Object.freeze([
    Object.freeze({
      name: "CPI",
      impact: "high" as const,
      startsAt: minutesFromNow(5),
    }),
    Object.freeze({
      name: "FOMC Rate Decision",
      impact: "high" as const,
      startsAt: minutesFromNow(-3),
    }),
  ]);

  assert.doesNotThrow(() => {
    evaluateEconomicGate(events as unknown as RawEconomicEvent[], NOW, {
      dataStatus: "AVAILABLE",
      hasOpenPosition: true,
    });
  });
});

// ============================================================
// 8) تطابق أسماء الأحداث بصيغها الكاملة كما تصل من Finnhub
// ============================================================

test("يلتقط 'Consumer Price Index' ضمن سياسة CPI (before=10, after=20)", () => {
  const events: RawEconomicEvent[] = [
    { name: "Consumer Price Index (CPI) YoY", impact: "high", startsAt: minutesFromNow(9) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.blockMinutesBefore, 10);
});

test("يلتقط 'Personal Consumption Expenditures' ضمن سياسة PCE", () => {
  const events: RawEconomicEvent[] = [
    { name: "Personal Consumption Expenditures Price Index", impact: "high", startsAt: minutesFromNow(9) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.blockMinutesBefore, 10);
});

test("يلتقط 'Federal Funds Rate' ضمن سياسة FOMC (before=15, after=30)", () => {
  const events: RawEconomicEvent[] = [
    { name: "Federal Funds Rate Decision", impact: "high", startsAt: minutesFromNow(14) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.blockMinutesBefore, 15);
});

test("يلتقط 'Nonfarm Payrolls' ضمن سياسة NFP (before=10, after=20)", () => {
  const events: RawEconomicEvent[] = [
    { name: "Nonfarm Payrolls", impact: "high", startsAt: minutesFromNow(9) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.blockMinutesBefore, 10);
});

test("حدث high غير مصنَّف (مثل Retail Sales) يقع تحت السياسة العامة (before=10, after=15)", () => {
  const events: RawEconomicEvent[] = [
    { name: "Retail Sales m/m", impact: "high", startsAt: minutesFromNow(8) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.level, "BLOCK");
  assert.equal(result.activeEvent?.blockMinutesBefore, 10);
  assert.equal(result.activeEvent?.blockMinutesAfter, 15);
});

// ============================================================
// المراكز المفتوحة
// ============================================================

test("مركز مفتوح + BLOCK => AVOID_NEW_SIZE", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(5) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: true });
  assert.equal(result.warnExistingPositions, true);
  assert.equal(result.existingPositionAction, "AVOID_NEW_SIZE");
});

test("لا مركز مفتوح => لا تحذير حتى مع BLOCK", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(5) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.warnExistingPositions, false);
  assert.equal(result.existingPositionAction, "NONE");
});

test("مركز مفتوح + UNAVAILABLE => REVIEW_STOPS", () => {
  const result = evaluateEconomicGate([], NOW, { dataStatus: "UNAVAILABLE", hasOpenPosition: true });
  assert.equal(result.warnExistingPositions, true);
  assert.equal(result.existingPositionAction, "REVIEW_STOPS");
});

// ============================================================
// التقريب عند العرض
// ============================================================

test("حدث بعد 24 ثانية (0.4 دقيقة) => يُعرض 'خلال 1 دقيقة' لا 0", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(0.4) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.activeEvent?.minutesUntilEvent, 1);
});

test("حدث قبل 24 ثانية (0.4 دقيقة مضت) => يُعرض 'منذ 0 دقيقة'", () => {
  const events: RawEconomicEvent[] = [
    { name: "FOMC Rate Decision", impact: "high", startsAt: minutesFromNow(-0.4) },
  ];
  const result = evaluateEconomicGate(events, NOW, { dataStatus: "AVAILABLE", hasOpenPosition: false });
  assert.equal(result.activeEvent?.minutesSinceEvent, 0);
});
