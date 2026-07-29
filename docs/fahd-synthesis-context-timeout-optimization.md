# Optimize Fahd synthesis context and timeout fallback

**النطاق:** طبقة صياغة الرد النصي (Anthropic synthesis) في `/api/fahd-chat` فقط — تلخيص السياق قبل الإرسال، ورفع المهلة بعد التقليل، وretry بمدخل أصغر. **لا تعديل** على محرك السوق، نتائج الأدوات، الـ scoring، أو منطق CZT نفسه — محرك السوق يفحص وينتج نتيجة صحيحة فعلًا؛ المشكلة فقط في طبقة تحويلها لنص عربي طبيعي.

**السبب الموثّق من سجلات Vercel الفعلية (2026-07-29):**
```
Anthropic prompt cache usage: { input_tokens: 6097, cache_creation_input_tokens: 26559, ... }
Anthropic request timed out; retrying once. { attempt: 1 }
Anthropic synthesis timed out; using deterministic Fahd output. { completedTools: [...] }
```
برومبت الصياغة يحمل ~26.5 ألف توكن من نتائج الأدوات الخام، وهذا الحجم يسبب التايم آوت. الأولوية: **عالية** — يؤثر على تجربة المحادثة مباشرة، بدون ما يعني تعطّل فحص الفرص.

---

## 1) تلخيص بيانات الأدوات قبل الصياغة

بدل تمرير نتائج الأدوات الخام كاملة (كل العقود المفحوصة، كل الرموز المرفوضة، السجلات التفصيلية) لطبقة Anthropic، نبني ملخص صغير وموحّد الشكل قبل الإرسال:

```typescript
// lib/fahd/synthesis-summary.ts

interface ToolResultSummary {
  decision: string;              // القرار النهائي (مثلاً "لا توجد فرصة الآن")
  contractsScanned: number;      // عدد العقود المفحوصة
  contractsAccepted: number;     // عدد المقبول بعد الفلترة
  topOpportunities: TopOpportunity[]; // أفضل 3 فرص فقط، لا أكثر
  rejectionReasons: string[];    // أسباب الرفض الرئيسية (مختصرة، لا قائمة كاملة)
  dataStatus: {
    freshness: string;           // "live" | "cached" | "stale"
    updatedAt: string;           // ISO timestamp
  };
}

interface TopOpportunity {
  symbol: string;
  grade: "A" | "B" | "C";
  summary: string; // سطر أو سطرين، لا التفاصيل الكاملة
}

/**
 * يحوّل نتيجة أداة خام (قد تكون آلاف العقود) إلى ملخص صغير وثابت البنية
 * جاهز للإرسال لطبقة الصياغة. هذا هو الحد الوحيد المسموح أن يمر لـ Anthropic.
 */
function summarizeToolResult(rawResult: RawToolResult): ToolResultSummary {
  const accepted = rawResult.contracts.filter((c) => c.passedFilter);
  const topThree = accepted
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => ({
      symbol: c.symbol,
      grade: c.grade,
      summary: c.shortReason, // سطر مختصر جاهز مسبقًا، لا الكائن الكامل
    }));

  return {
    decision: accepted.length === 0 ? "لا توجد فرصة الآن" : "فرص متاحة",
    contractsScanned: rawResult.contracts.length,
    contractsAccepted: accepted.length,
    topOpportunities: topThree,
    rejectionReasons: summarizeRejectionReasons(rawResult.contracts), // أهم 2-3 أسباب فقط، لا قائمة كاملة
    dataStatus: {
      freshness: rawResult.dataFreshness,
      updatedAt: rawResult.updatedAt,
    },
  };
}
```

**قاعدة صارمة:** أي نقطة في الكود ترسل نتيجة أداة لطبقة Anthropic، لازم تمر أولًا عبر `summarizeToolResult` (أو مكافئها لكل أداة). **ممنوع** إرسال:
- قائمة العقود المرفوضة كاملة
- نتائج الأدوات الخام (raw JSON الكامل)
- أكثر من 3 فرص في نفس الرسالة

---

## 2) رفع مهلة الصياغة بعد التقليل (وليس بدلًا عنه)

```typescript
// lib/fahd/synthesis-config.ts

// كانت المهلة القصيرة تتناسب مع برومبت ~26 ألف توكن — بعد التلخيص المفروض
// يصير الحجم أصغر بكثير، فرفع المهلة شيء معتدل احترازي، لا حل أساسي.
export const SYNTHESIS_TIMEOUT_MS = 25_000; // 25 ثانية — ضمن مدى 20-30 المطلوب

// عند فشل المحاولة الأولى، الـ retry يجب أن يستخدم مدخل أصغر،
// لا نفس البرومبت الأصلي (لأن نفس الحجم يفشل بنفس الطريقة غالبًا).
export const RETRY_MAX_TOP_OPPORTUNITIES = 1; // بدل 3 في المحاولة الأولى
export const RETRY_DROP_REJECTION_REASONS = true; // نحذفها كليًا بمحاولة الإعادة
```

---

## 3) منطق الإعادة بمدخل مصغّر عند أول Timeout

```typescript
// lib/fahd/synthesis-runner.ts

interface SynthesisAttemptResult {
  text: string | null;
  usedFallback: boolean;
}

/**
 * يحاول صياغة الرد. عند أول timeout، يعيد المحاولة بملخص أصغر
 * (فرصة وحدة بدل 3، بدون أسباب رفض) بدل نفس المدخل الأصلي.
 * لو فشلت المحاولة الثانية أيضًا، fallback للنتيجة البرمجية الخام —
 * هذا السلوك موجود ومُثبت فعاليته، لا يتغير.
 */
export async function runSynthesisWithSmartRetry(
  summary: ToolResultSummary,
  callAnthropic: (prompt: string, timeoutMs: number) => Promise<string>
): Promise<SynthesisAttemptResult> {
  try {
    const fullPrompt = buildSynthesisPrompt(summary);
    const text = await callAnthropic(fullPrompt, SYNTHESIS_TIMEOUT_MS);
    return { text, usedFallback: false };
  } catch (firstError) {
    console.error("Anthropic synthesis timed out on first attempt; retrying with smaller context.", firstError);

    try {
      const reducedSummary: ToolResultSummary = {
        ...summary,
        topOpportunities: summary.topOpportunities.slice(0, RETRY_MAX_TOP_OPPORTUNITIES),
        rejectionReasons: RETRY_DROP_REJECTION_REASONS ? [] : summary.rejectionReasons,
      };
      const reducedPrompt = buildSynthesisPrompt(reducedSummary);
      const text = await callAnthropic(reducedPrompt, SYNTHESIS_TIMEOUT_MS);
      return { text, usedFallback: false };
    } catch (secondError) {
      // fallback الحالي — يبقى كما هو، أثبت أنه يمنع فشل الرد بالكامل
      console.error("Anthropic synthesis timed out on retry with reduced context; using deterministic output.", secondError);
      return { text: null, usedFallback: true };
    }
  }
}
```

**نقطة تكامل مطلوبة من Codex:** `buildSynthesisPrompt` و`callAnthropic` موجودتين أصلًا في الكود الحالي — فقط تأكد إن `buildSynthesisPrompt` تستقبل `ToolResultSummary` الصغير بدل الكائن الخام الحالي، وإن استدعاء الـ retry الحالي يُستبدل بهذا المنطق (مدخل مصغّر لا مدخل مكرر).

---

## 4) الإبقاء على الـ fallback الحالي بدون تغيير

الـ fallback للنتيجة البرمجية الخام عند فشل المحاولتين **يبقى كما هو تمامًا** — أثبت فعاليته بمنع انقطاع الرد بالكامل. لا تعديل مطلوب هنا، فقط تأكيد إنه ما زال آخر خط دفاع بعد محاولتين (أصلية + مصغّرة) بدل محاولة واحدة فقط.

---

## 5) الاختبارات المطلوبة

```typescript
// __tests__/fahd-synthesis-optimization.test.ts
describe("Synthesis context reduction and timeout retry", () => {
  it("summarizes a large raw tool result into a small structured summary", () => {
    const summary = summarizeToolResult(mockRawResultWith5100Contracts);
    expect(summary.topOpportunities.length).toBeLessThanOrEqual(3);
    expect(summary.contractsScanned).toBe(5100);
  });

  it("never includes the full rejected-contracts list in the synthesis prompt", () => {
    const summary = summarizeToolResult(mockRawResultWith5100Contracts);
    const prompt = buildSynthesisPrompt(summary);
    expect(prompt.length).toBeLessThan(RAW_PROMPT_SIZE_THRESHOLD);
  });

  it("retries with a smaller payload (1 opportunity, no rejection reasons) after first timeout", async () => {
    const callAnthropic = jest.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("رد نصي مختصر");
    await runSynthesisWithSmartRetry(mockSummary, callAnthropic);
    const secondCallPrompt = callAnthropic.mock.calls[1][0];
    expect(secondCallPrompt).not.toContain(mockSummary.rejectionReasons[0]);
  });

  it("falls back to deterministic output when both attempts time out, without throwing", async () => {
    const callAnthropic = jest.fn().mockRejectedValue(new Error("timeout"));
    const result = await runSynthesisWithSmartRetry(mockSummary, callAnthropic);
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBeNull();
  });

  it("does not modify the underlying market engine result, only the synthesis input", () => {
    const rawResult = mockRawResultWith5100Contracts;
    summarizeToolResult(rawResult);
    expect(rawResult.contracts.length).toBe(5100); // لم يتغير الأصل
  });
});
```

---

## ملخص للتسليم

| البند | الحالة |
|---|---|
| تلخيص نتائج الأدوات قبل الصياغة (قرار، عدد مفحوص/مقبول، أفضل 3، أسباب رفض، حالة البيانات) | كود جاهز — قسم 1 |
| منع إرسال القوائم/النتائج الخام الكاملة لـ Anthropic | قاعدة صارمة — قسم 1 |
| رفع المهلة إلى 20-30 ثانية (بعد التقليل، لا بدلًا عنه) | كود جاهز — قسم 2 |
| Retry بمدخل مصغّر بدل نفس الحجم | كود جاهز — قسم 3 |
| الإبقاء على fallback الحالي دون تغيير | مؤكد — قسم 4 |
| اختبارات | جاهزة كإطار — تحتاج mocks حسب بنية المشروع الفعلية |
| لا تعديل على محرك السوق/الـ scoring/نتائج الأدوات نفسها | ملتزم — الإصلاح محصور بطبقة الصياغة فقط |
| الأولوية | عالية — يؤثر على تجربة المحادثة، لا على صحة فحص الفرص |
