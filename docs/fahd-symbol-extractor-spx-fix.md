# إصلاح مستخرج الرموز ومسار سعر SPX — `/api/fahd-chat`

**النطاق:** استخراج الرموز وتوجيه مزود السعر فقط. **لا تعديل** على محرك السوق، الـ scoring، أو منطق التداول.

> ملاحظة: ما عندي وصول مباشر لكود المشروع (GitHub غير متصل)، فهذا الملف مواصفة + تطبيق مرجعي (reference implementation) بصيغة TypeScript صارمة (بدون `any`، مع type guards وأخطاء صريحة) — حسب تفضيلك المعتاد. Codex يطبّقها على البنية الفعلية للملفات (`route.ts`، مستخرج الرموز الحالي، وطبقة استدعاء Finnhub/Twelve Data).

---

## 1) إصلاح مستخرج الرموز

### 1.1 قائمة استبعاد سريعة (طبقة حماية أولى)

```typescript
// lib/fahd/symbol-blacklist.ts
export const SYMBOL_BLACKLIST = new Set([
  "THE", "AND", "FOR", "ARE", "WITH", "FROM",
  "THIS", "THAT", "HAVE", "WILL", "YOU", "NOT",
  "BUT", "CAN", "ALL", "NOW", "GET", "NEW",
]);

export function isBlacklistedWord(token: string): boolean {
  return SYMBOL_BLACKLIST.has(token.toUpperCase());
}
```

هذي طبقة سريعة تمنع الحالات الشائعة بدون أي استدعاء شبكة. **ما تكفي وحدها** لأنها قائمة ثابتة — أي كلمة جديدة تتسرب مستقبلًا (مثلاً "ARE" لو ما أضفتها) تعدي منها. لذلك لازم طبقة التحقق الفعلي (1.2).

### 1.2 التحقق من صلاحية الرمز عند المزوّد + تخزين مؤقت (cache)

الهدف: قبل أي طلب سعر، تأكد إن الرمز حقيقي عند المزوّد، وخزّن النتيجة (صالح/غير صالح) عشان ما تكرر نفس التحقق كل مرة وتزيد الحمل على Finnhub/Twelve Data.

> **تحديث بعد المراجعة:** التحقق الثنائي (valid/invalid) يخلط بين "الرمز غير موجود فعلًا" و"مزوّد التحقق تعطل مؤقتًا" — وهذا يعني عطل شبكة عابر يقدر يحظر رمز صحيح زي `TSLA` لمدة 6 ساعات كاملة. الحل: نتيجة **ثلاثية الحالة** (`valid` / `invalid` / `unknown`)، مع TTL مختلف لكل حالة.

```typescript
// lib/fahd/symbol-validation.ts
import { SYMBOL_BLACKLIST, isBlacklistedWord } from "./symbol-blacklist";

type SymbolValidationStatus = "valid" | "invalid" | "unknown";

interface SymbolValidationResult {
  symbol: string;
  status: SymbolValidationStatus;
  checkedAt: number;
}

// كاش في الذاكرة — نفس نمط in-flight dedup المستخدم أصلاً مع Twelve Data
const validationCache = new Map<string, SymbolValidationResult>();
const inFlightChecks = new Map<string, Promise<SymbolValidationResult>>();

const VALID_INVALID_TTL_MS = 6 * 60 * 60 * 1000; // 6 ساعات — لنتائج مؤكدة (valid/invalid)
const UNKNOWN_TTL_MS = 60 * 1000; // دقيقة واحدة فقط — لعطل مؤقت في مزود التحقق

function ttlFor(status: SymbolValidationStatus): number {
  return status === "unknown" ? UNKNOWN_TTL_MS : VALID_INVALID_TTL_MS;
}

function isCacheFresh(result: SymbolValidationResult): boolean {
  return Date.now() - result.checkedAt < ttlFor(result.status);
}

/**
 * يتحقق من صلاحية رمز عند المزوّد، مع طبقة كاش ثلاثية الحالة ومنع تكرار الطلبات المتزامنة.
 * لا يرمي استثناء أبدًا. فشل الشبكة/المزوّد يرجع "unknown" (كاش قصير جدًا)،
 * لا "invalid" (كاش طويل) — حتى لا نحظر رمز صحيح بسبب عطل عابر.
 */
export async function validateSymbol(
  rawSymbol: string,
  checkAtProvider: (symbol: string) => Promise<boolean>
): Promise<SymbolValidationResult> {
  const symbol = rawSymbol.trim().toUpperCase();

  if (symbol.length === 0 || symbol.length > 6 || isBlacklistedWord(symbol)) {
    return { symbol, status: "invalid", checkedAt: Date.now() };
  }

  const cached = validationCache.get(symbol);
  if (cached && isCacheFresh(cached)) {
    return cached;
  }

  const existingCheck = inFlightChecks.get(symbol);
  if (existingCheck) {
    return existingCheck;
  }

  const checkPromise = (async (): Promise<SymbolValidationResult> => {
    let status: SymbolValidationStatus;
    try {
      const found = await checkAtProvider(symbol);
      status = found ? "valid" : "invalid";
    } catch (error) {
      // فشل شبكة/مزوّد — "unknown" وليس "invalid"، وكاش قصير جدًا (دقيقة)
      console.error(`Symbol validation provider error for ${symbol}:`, error);
      status = "unknown";
    }
    const result: SymbolValidationResult = { symbol, status, checkedAt: Date.now() };
    validationCache.set(symbol, result);
    return result;
  })();

  inFlightChecks.set(symbol, checkPromise);
  try {
    return await checkPromise;
  } finally {
    inFlightChecks.delete(symbol);
  }
}
```

**نقطة تكامل مطلوبة من Codex:** دالة `checkAtProvider` لازم تُمرَّر من الكود الفعلي الحالي — إما endpoint خفيف عند Finnhub/Twelve Data للتحقق من وجود الرمز (symbol lookup)، أو إعادة استخدام أي دالة تحقق موجودة أصلًا في المشروع. لا تنشئ استدعاء سعر كامل فقط للتحقق — استخدم أخف endpoint متاح (symbol search/lookup).

### 1.3 دمج الفلترة في مستخرج الرموز الحالي

في نقطة استخراج الرموز داخل `/api/fahd-chat/route.ts` (أو الملف المخصص للاستخراج)، أضف تمريرة تحقق قبل تمرير أي رمز لطلب السعر. القرار: `unknown` يُعامل معاملة "نمرّره بحذر" لا "نحظره" — لأنه غالبًا عطل شبكة عابر، وحظره فعليًا يعني رفض رموز صحيحة عند أي بطء بالمزوّد. الأفضل تمريره لطلب السعر مع علم إنه غير مؤكد، بدل حظره كأنه رمز وهمي:

```typescript
// مثال دمج — عدّل حسب اسم الدالة الفعلية عندكم
async function extractValidSymbols(
  rawTokens: string[],
  checkAtProvider: (symbol: string) => Promise<boolean>
): Promise<string[]> {
  const validated = await Promise.all(
    rawTokens.map((token) => validateSymbol(token, checkAtProvider))
  );
  // نستبعد invalid فقط (رموز مؤكد إنها غلط أو كلمات شائعة)
  // unknown يمر — عطل مؤقت بالمزوّد لا يعني إن الرمز خطأ
  return validated.filter((r) => r.status !== "invalid").map((r) => r.symbol);
}
```

---

## 2) إصلاح مسار سعر SPX

**الترتيب المطلوب** (بدون لمس محرك التحليل نفسه — فقط طبقة جلب السعر):

```typescript
// lib/fahd/spx-price.ts

interface PriceResult {
  price: number;
  source: "index_direct" | "gspc" | "spy_proxy";
  isEstimated: boolean;
}

/**
 * يجلب سعر SPX بالترتيب: مصدر مباشر موثوق → GSPC → SPY Dynamic Proxy.
 * لا يرجع أبدًا سعر 0 أو نتيجة فارغة — يرمي خطأ صريح بدل ذلك.
 */
export async function getSpxPrice(): Promise<PriceResult> {
  // 1) السعر المباشر الموثوق للمؤشر إن توفر (Tradier أو مصدر index مخصص — ليس Finnhub بصيغة "SPX")
  const direct = await tryDirectIndexPrice();
  if (direct !== null && direct > 0) {
    return { price: direct, source: "index_direct", isEstimated: false };
  }

  // 2) GSPC إن كان مدعوم عند المزوّد
  const gspc = await tryGspcPrice();
  if (gspc !== null && gspc > 0) {
    return { price: gspc, source: "gspc", isEstimated: false };
  }

  // 3) SPY Dynamic Proxy — احتياطي فقط، مع تعليم صريح إنه تقديري
  const proxy = await trySpyDynamicProxy();
  if (proxy !== null && proxy > 0) {
    return { price: proxy, source: "spy_proxy", isEstimated: true };
  }

  // لا سعر صالح من أي مصدر — خطأ صريح، ما نرجع صفر أو undefined
  throw new Error("SPX price unavailable from all sources (direct, GSPC, SPY proxy)");
}
```

**نقطة تكامل مطلوبة من Codex:** `tryDirectIndexPrice`, `tryGspcPrice`, `trySpyDynamicProxy` — أعد استخدام نفس الدوال/المنطق الموجود فعلًا في مشروع فهد (المذكور سابقًا كـ "GSPC + SPY Dynamic Proxy with confidence scoring")، فقط تأكد إنها مربوطة فعليًا بمسار `/api/fahd-chat` ومو موجودة بس في مسار تحليلي آخر.

### 2.1 منع استخدام `SPX` مباشرة عند Finnhub

فتّش أي مكان في `/api/fahd-chat` يستدعي Finnhub بـ symbol `"SPX"` حرفيًا واستبدله باستدعاء `getSpxPrice()` أعلاه. Finnhub لا يدعم `SPX` بهذه الصيغة أصلًا — وهذا سبب الخطأ `Finnhub quote empty/zero for SPX`.

### 2.2 منع تسرب السعر صفر/فارغ للتحليل

أي نقطة في الكود تستقبل نتيجة سعر من Finnhub لازم تتحقق:

```typescript
function isValidQuote(quote: { c: number }): boolean {
  return quote.c > 0;
}
```

وإذا `isValidQuote` رجعت `false`، الرد يكون "price unavailable" واضح داخل رد فهد (مو رقم صفر يدخل التحليل الفني).

---

## 3) الاختبارات المطلوبة

```typescript
// __tests__/fahd-symbol-price.test.ts
describe("Symbol extraction filtering", () => {
  it("does not trigger a price request for 'THE' inside a sentence", async () => {
    const symbols = await extractValidSymbols(["حلل", "THE", "market"], mockCheckAtProvider);
    expect(symbols).not.toContain("THE");
  });

  it("accepts TSLA normally", async () => {
    const symbols = await extractValidSymbols(["TSLA"], mockCheckAtProviderValid);
    expect(symbols).toContain("TSLA");
  });

  it("never sends 'SPX' to Finnhub directly", async () => {
    const spy = jest.spyOn(finnhubClient, "getQuote");
    await getSpxPrice();
    expect(spy).not.toHaveBeenCalledWith("SPX");
  });

  it("a provider network failure returns 'unknown' and does not permanently block a valid symbol", async () => {
    const result = await validateSymbol("TSLA", mockCheckAtProviderThrows);
    expect(result.status).toBe("unknown");
    // كاش قصير — بعد دقيقة لازم يعيد المحاولة، مو محظور 6 ساعات
  });

  it("a genuinely non-existent symbol is cached as 'invalid' and does not break Fahd's reply", async () => {
    const symbols = await extractValidSymbols(["XZQVT"], mockCheckAtProviderNotFound);
    expect(symbols).toEqual([]); // فلترة صامتة، بدون استثناء يوقف الرد
  });

  it("provider returning zero price results in fallback or 'price unavailable', not a real price", async () => {
    mockFinnhub.getQuote.mockResolvedValue({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    const result = await getSafeQuote("SPY");
    expect(result.status).toBe("unavailable");
    expect(result.price).not.toBe(0);
  });
});
```

---

## ملخص للتسليم

| البند | الحالة |
|---|---|
| منع كلمات شائعة (THE, AND, FOR...) | كود جاهز — قسم 1.1 |
| تحقق فعلي من الرمز + كاش ثلاثي الحالة (valid/invalid/unknown) | كود جاهز — قسم 1.2، يحتاج ربط `checkAtProvider` بالمزوّد الفعلي. عطل شبكة = `unknown` بكاش دقيقة واحدة، لا `invalid` بكاش 6 ساعات |
| ترتيب مصادر SPX (direct → GSPC → proxy) | كود جاهز — قسم 2، يحتاج ربط الدوال الثلاث بالمنطق الموجود فعلًا |
| منع صفر/فارغ من دخول التحليل | كود جاهز — قسم 2.2 |
| اختبارات | جاهزة كإطار — تحتاج mocks حسب بنية المشروع الفعلية |
| لا تعديل على محرك السوق/الـ scoring | ملتزم — الإصلاح محصور بطبقة الاستخراج وجلب السعر فقط |
