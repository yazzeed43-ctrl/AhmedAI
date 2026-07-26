/**
 * economic-calendar-gate.ts (v2)
 *
 * بوابة حتمية (Pure, Deterministic Gate) لتقويم الأخبار الاقتصادية.
 * لا تستدعي أي API ولا أي نموذج لغوي — تأخذ بيانات جاهزة وتُرجع قراراً محدداً.
 *
 * ملاحظات إصدار v2 (مراجعة يزيد الشريف):
 * - dataStatus بديل ثلاثي (AVAILABLE/UNAVAILABLE/PARTIAL) بدل dataAvailable الثنائي.
 * - عند PARTIAL: إن لم يوجد حدث نشط، النتيجة CAUTION وليست NONE (القائمة قد تكون ناقصة).
 * - تواريخ startsAt غير الصالحة تُتجاهل بأمان (event تُستبعد من التقييم، لا تُسقط الدالة).
 * - كسر التعادل بين أحداث BLOCK متعددة: الأقرب زمنياً أولاً، ثم الأوسع نافذة.
 * - تقريب الدقائق: المستقبل يُقرَّب لأعلى بحد أدنى 1 (لا "خلال 0 دقيقة")، الماضي يُقرَّب لأسفل بحد أدنى 0.
 * - resolvePolicy يرجع null مباشرة للأحداث medium/low (لا تدخل التقييم إطلاقاً).
 *
 * ⚠️ ملاحظة لطبقة الجلب (route.ts): يجب أن يشمل نطاق الاستعلام من Finnhub
 * من (الآن - 60 دقيقة) إلى (الآن + 24 ساعة) على الأقل، وإلا نافذة "بعد الحدث"
 * هنا لن تُستخدم أبداً لأن الأحداث الماضية لن تصل أصلاً.
 */

// ============================================================
// الأنواع (Types)
// ============================================================

export type EventImpact = "low" | "medium" | "high";

export type GateLevel = "NONE" | "CAUTION" | "BLOCK";

export type DataStatus = "AVAILABLE" | "UNAVAILABLE" | "PARTIAL";

export type ExistingPositionAction =
  | "NONE"
  | "REVIEW_STOPS"
  | "REDUCE_RISK"
  | "AVOID_NEW_SIZE";

export type EconomicBlockCause =
  | "NONE"
  | "ECONOMIC_EVENT"
  | "INCOMPLETE_DATA"
  | "EVENT_AND_INCOMPLETE_DATA";

export type EconomicEventPolicy = {
  policyName: string;
  blockMinutesBefore: number;
  blockMinutesAfter: number;
};

/** الحدث الاقتصادي كما يصل من مصدر البيانات (بعد التطبيع) */
export type RawEconomicEvent = {
  name: string;
  impact: EventImpact;
  /** توقيت الحدث بصيغة ISO 8601 (UTC) */
  startsAt: string;
};

export type ActiveEventDetail = {
  name: string;
  impact: EventImpact;
  startsAt: string;
  minutesUntilEvent: number | null;
  minutesSinceEvent: number | null;
  blockMinutesBefore: number;
  blockMinutesAfter: number;
};

export type EconomicGateDecision = {
  level: GateLevel;
  blockNewTrades: boolean;
  blockCause: EconomicBlockCause;
  warnExistingPositions: boolean;
  existingPositionAction: ExistingPositionAction;
  dataStatus: DataStatus;
  activeEvent?: ActiveEventDetail;
  reason: string;
};

// ============================================================
// جدول مطابقة الأحداث بالسياسة (قابل للتحديث)
// ============================================================

const EVENT_POLICY_RULES: Array<{
  keywords: string[];
  policy: EconomicEventPolicy;
}> = [
  {
    keywords: ["fomc", "fed rate", "federal funds", "interest rate decision"],
    policy: { policyName: "FOMC_RATE_DECISION", blockMinutesBefore: 15, blockMinutesAfter: 30 },
  },
  {
    keywords: ["non-farm", "nonfarm", "nfp", "payrolls"],
    policy: { policyName: "NFP", blockMinutesBefore: 10, blockMinutesAfter: 20 },
  },
  {
    keywords: ["cpi", "consumer price index"],
    policy: { policyName: "CPI", blockMinutesBefore: 10, blockMinutesAfter: 20 },
  },
  {
    keywords: ["pce", "personal consumption expenditures"],
    policy: { policyName: "PCE", blockMinutesBefore: 10, blockMinutesAfter: 20 },
  },
];

const HIGH_IMPACT_GENERIC_POLICY: EconomicEventPolicy = {
  policyName: "HIGH_IMPACT_GENERIC",
  blockMinutesBefore: 10,
  blockMinutesAfter: 15,
};

/**
 * ترجع null للأحداث medium/low — لا تدخل التقييم إطلاقاً (لا BLOCK ولا CAUTION منها).
 * هذا أوضح من "سياسة بنافذة صفر" لأنه يمنع أي التباس مستقبلي حول أنها "تحذّر".
 */
function resolvePolicy(event: RawEconomicEvent): EconomicEventPolicy | null {
  if (event.impact !== "high") {
    return null;
  }
  const normalizedName = event.name.toLowerCase();
  for (const rule of EVENT_POLICY_RULES) {
    if (rule.keywords.some((kw) => normalizedName.includes(kw))) {
      return rule.policy;
    }
  }
  return HIGH_IMPACT_GENERIC_POLICY;
}

// ============================================================
// المنطق الأساسي
// ============================================================

const MS_PER_MINUTE = 60_000;

/**
 * يحسب حالة حدث واحد بالنسبة للوقت الحالي.
 * يرجع null لو: التاريخ غير صالح، السياسة غير موجودة (medium/low)، أو خارج أي نافذة تأثير.
 */
function evaluateSingleEvent(
  event: RawEconomicEvent,
  nowEpochMs: number,
): { level: GateLevel; detail: ActiveEventDetail } | null {
  const eventMs = Date.parse(event.startsAt);
  if (!Number.isFinite(eventMs)) {
    // تاريخ غير صالح — نتجاهل هذا الحدث بأمان بدل إسقاط الدالة أو التصرف بصمت
    // كأنه "لا يوجد حدث". طبقة التطبيع في route.ts هي من يقرر رفع dataStatus إلى PARTIAL
    // في هذه الحالة (لأن سجلاً واحداً على الأقل كان معطوباً).
    return null;
  }

  const policy = resolvePolicy(event);
  if (!policy) return null;

  const minutesUntilRaw = (eventMs - nowEpochMs) / MS_PER_MINUTE;

  const isBeforeWindow = minutesUntilRaw > 0 && minutesUntilRaw <= policy.blockMinutesBefore;
  const isAfterWindow =
    minutesUntilRaw <= 0 && Math.abs(minutesUntilRaw) <= policy.blockMinutesAfter;

  if (!isBeforeWindow && !isAfterWindow) {
    return null;
  }

  const level: GateLevel = event.impact === "high" ? "BLOCK" : "CAUTION";

  // تقريب العرض: المستقبل لأعلى (حد أدنى 1، لا نعرض "خلال 0 دقيقة")
  // الماضي لأسفل (حد أدنى 0)
  const minutesUntilEvent =
    minutesUntilRaw > 0 ? Math.max(1, Math.ceil(minutesUntilRaw)) : null;
  const minutesSinceEvent =
    minutesUntilRaw <= 0 ? Math.max(0, Math.floor(Math.abs(minutesUntilRaw))) : null;

  const detail: ActiveEventDetail = {
    name: event.name,
    impact: event.impact,
    startsAt: event.startsAt,
    minutesUntilEvent,
    minutesSinceEvent,
    blockMinutesBefore: policy.blockMinutesBefore,
    blockMinutesAfter: policy.blockMinutesAfter,
  };

  return { level, detail };
}

const LEVEL_SEVERITY: Record<GateLevel, number> = {
  NONE: 0,
  CAUTION: 1,
  BLOCK: 2,
};

/** المسافة الزمنية المطلقة بالدقائق (للمفاضلة بين الأحداث المتزامنة) */
function distanceToEvent(detail: ActiveEventDetail): number {
  if (detail.minutesUntilEvent !== null) return detail.minutesUntilEvent;
  if (detail.minutesSinceEvent !== null) return detail.minutesSinceEvent;
  return Infinity;
}

function isBetter(
  candidate: { level: GateLevel; detail: ActiveEventDetail },
  current: { level: GateLevel; detail: ActiveEventDetail } | null,
): boolean {
  if (!current) return true;

  const candidateSeverity = LEVEL_SEVERITY[candidate.level];
  const currentSeverity = LEVEL_SEVERITY[current.level];

  if (candidateSeverity !== currentSeverity) {
    return candidateSeverity > currentSeverity;
  }

  // نفس الشدة: الأقرب زمنياً يفوز أولاً
  const candidateDistance = distanceToEvent(candidate.detail);
  const currentDistance = distanceToEvent(current.detail);
  if (candidateDistance !== currentDistance) {
    return candidateDistance < currentDistance;
  }

  // تعادل كامل بالقرب: كسر التعادل الثاني هو النافذة الأوسع (الأكثر تحفظاً)
  const candidateWindow = candidate.detail.blockMinutesBefore + candidate.detail.blockMinutesAfter;
  const currentWindow = current.detail.blockMinutesBefore + current.detail.blockMinutesAfter;
  if (candidateWindow !== currentWindow) {
    return candidateWindow > currentWindow;
  }

  // تعادل كامل في كل شيء (الشدة + القرب + النافذة): يُحافظ على ترتيب المصدر
  // (stable ordering) — العنصر الأول في المصفوفة يبقى الفائز، والسلوك هنا
  // مقصود وموثَّق صراحة، وليس نتيجة عرضية لطريقة عمل الحلقة.
  return false;
}

/**
 * الدالة الرئيسية — نقية بالكامل، بدون أي I/O، ولا تعدّل المصفوفة المُمرَّرة.
 *
 * @param events قائمة الأحداث الاقتصادية (منظّفة/مطبَّعة مسبقاً من طبقة الجلب)
 * @param nowEpochMs الوقت الحالي بالميلي ثانية (يُمرَّر صراحة لضمان قابلية الاختبار)
 * @param options.dataStatus حالة نجاح جلب التقويم من المصدر
 * @param options.hasOpenPosition هل يوجد مركز مفتوح على الرمز الحالي؟
 */
export function evaluateEconomicGate(
  events: readonly RawEconomicEvent[],
  nowEpochMs: number,
  options: {
    dataStatus: DataStatus;
    hasOpenPosition: boolean;
  },
): EconomicGateDecision {
  // 1) فشل كامل في جلب البيانات — CAUTION، لا BLOCK أعمى
  if (options.dataStatus === "UNAVAILABLE") {
    return {
      level: "CAUTION",
      blockNewTrades: true,
      blockCause: "INCOMPLETE_DATA",
      warnExistingPositions: options.hasOpenPosition,
      existingPositionAction: options.hasOpenPosition ? "AVOID_NEW_SIZE" : "NONE",
      dataStatus: "UNAVAILABLE",
      reason:
        "تعذر التحقق من التقويم الاقتصادي حاليًا؛ تم تعليق فتح صفقات جديدة حتى استعادة البيانات.",
    };
  }

  // 2) تقييم كل الأحداث المتاحة، واختيار الأشد (مع كسر التعادل بالقرب ثم عرض النافذة)
  let worst: { level: GateLevel; detail: ActiveEventDetail } | null = null;
  for (const event of events) {
    const result = evaluateSingleEvent(event, nowEpochMs);
    if (result && isBetter(result, worst)) {
      worst = result;
    }
  }

  // 3) لا يوجد حدث نشط
  if (!worst) {
    if (options.dataStatus === "PARTIAL") {
      // القائمة قد تكون ناقصة — لا نستطيع الجزم بعدم وجود خطر، فلا نرجع NONE
      return {
        level: "CAUTION",
        blockNewTrades: true,
        blockCause: "INCOMPLETE_DATA",
        warnExistingPositions: options.hasOpenPosition,
        existingPositionAction: options.hasOpenPosition ? "AVOID_NEW_SIZE" : "NONE",
        dataStatus: "PARTIAL",
        reason:
          "بيانات التقويم الاقتصادي غير مكتملة؛ تم تعليق فتح صفقات جديدة حتى اكتمال التحقق.",
      };
    }
    return {
      level: "NONE",
      blockNewTrades: false,
      blockCause: "NONE",
      warnExistingPositions: false,
      existingPositionAction: "NONE",
      dataStatus: "AVAILABLE",
      reason: "لا توجد أحداث اقتصادية مؤثرة ضمن النافذة الزمنية الحالية.",
    };
  }

  // 4) يوجد حدث ضمن النافذة (سواء كانت البيانات AVAILABLE أو PARTIAL)
  const blockedByEvent = worst.level === "BLOCK";
  const blockedByIncompleteData = options.dataStatus === "PARTIAL";
  const blockNewTrades = blockedByEvent || blockedByIncompleteData;
  const blockCause: EconomicBlockCause =
    blockedByEvent && blockedByIncompleteData
      ? "EVENT_AND_INCOMPLETE_DATA"
      : blockedByEvent
        ? "ECONOMIC_EVENT"
        : blockedByIncompleteData
          ? "INCOMPLETE_DATA"
          : "NONE";
  const timingText =
    worst.detail.minutesUntilEvent !== null
      ? `خلال ${worst.detail.minutesUntilEvent} دقيقة`
      : `منذ ${worst.detail.minutesSinceEvent} دقيقة`;

  const partialSuffix = options.dataStatus === "PARTIAL" ? " (تنبيه: القائمة قد تكون ناقصة)" : "";

  return {
    level: worst.level,
    blockNewTrades,
    blockCause,
    warnExistingPositions: options.hasOpenPosition,
    existingPositionAction: options.hasOpenPosition
      ? blockNewTrades
        ? "AVOID_NEW_SIZE"
        : "REVIEW_STOPS"
      : "NONE",
    dataStatus: options.dataStatus,
    activeEvent: worst.detail,
    reason:
      blockCause === "EVENT_AND_INCOMPLETE_DATA"
        ? `حدث اقتصادي مؤثر (${worst.detail.name}) ${timingText}، وبيانات التقويم غير مكتملة؛ تم تعليق فتح صفقات جديدة.`
        : blockCause === "ECONOMIC_EVENT"
          ? `حدث عالي التأثير (${worst.detail.name}) ${timingText} — تم منع فتح صفقات جديدة مؤقتًا.`
          : blockCause === "INCOMPLETE_DATA"
            ? `حدث اقتصادي (${worst.detail.name}) ${timingText}، لكن بيانات التقويم غير مكتملة؛ تم تعليق فتح صفقات جديدة حتى اكتمال التحقق.`
            : `حدث اقتصادي (${worst.detail.name}) ${timingText} — يُنصح بالحذر دون منع الدخول.${partialSuffix}`,
  };
}
