## تعديل مطلوب على lib/trading/signal-normalizer.ts (قبل إضافة الـ Adapter)

هذا الملف تعليمات فقط، وليس ملف كود جاهز للنسخ الكامل — لأن signal-normalizer.ts
ملف موجود أصلاً بالمشروع، والتعديل المطلوب هو إضافتان فقط في مكانين محددين
بدون لمس أي منطق قديم آخر.

---

### 1) إضافة الحقل الاختياري لـ TriggerData

ابحث عن:

```ts
export interface TriggerData {
  direction: Direction;
  candleClose: number;
  previousCandleClose?: number | null;
  breakoutLevel?: number | null;
  breakdownLevel?: number | null;
  priceAboveVwap?: boolean;
  priceBelowVwap?: boolean;
  relativeVolume?: number | null;
}
```

واستبدله بـ:

```ts
export interface TriggerData {
  direction: Direction;

  confirmationStatus?: TriggerStatus; // ⚠️ جديد — أولوية مطلقة لمسار AUTO

  candleClose: number;
  previousCandleClose?: number | null;

  breakoutLevel?: number | null;
  breakdownLevel?: number | null;

  priceAboveVwap?: boolean;
  priceBelowVwap?: boolean;

  relativeVolume?: number | null;
}
```

(تأكد أن `TriggerStatus` مُصدّر أصلاً من نفس الملف أو مستورد فيه — هو نوع
الإرجاع الحالي لـ evaluateTrigger، فمن المفترض موجود.)

---

### 2) إعطاء الأولوية داخل evaluateTrigger()

ابحث عن بداية الدالة:

```ts
const evaluateTrigger = (
  trigger: TriggerData,
): TriggerStatus => {
  // ... المنطق القديم (RVOL / VWAP / Breakout)
```

وأضف هذا كأول سطر داخل الدالة، قبل أي منطق آخر:

```ts
const evaluateTrigger = (
  trigger: TriggerData,
): TriggerStatus => {
  if (trigger.confirmationStatus) {
    return trigger.confirmationStatus;
  }

  // المنطق القديم يبقى كما هو تمامًا بدون أي تعديل آخر
  // ... (باقي الدالة بدون تغيير)
```

---

### لماذا هذا التعديل ضروري قبل تشغيل اختبارات auto-trade-input-adapter.test.ts؟

بدون هذا التعديل:
- toEngineTriggerData() سترجع كائن يحتوي confirmationStatus لكن TriggerData
  لن يعرف بهذا الحقل type-wise → فشل type-check.
- حتى لو تجاوزنا الـ type-check بالقوة، evaluateTrigger() القديمة ستتجاهل
  confirmationStatus وتعيد حساب التفعيل بمعايير RVOL/VWAP القديمة، وهذا
  بالضبط التعارض الذي اكتشفناه واتفقنا على منعه.

بعد هذا التعديل، مصدر الحقيقة الوحيد لحالة التفعيل بمسار AUTO يبقى
evaluateCandleConfirmation() من الخطوة (د)، ولا يُعاد تقييمه بمعايير مختلفة.
