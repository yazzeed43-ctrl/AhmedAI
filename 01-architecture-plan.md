# مشروع أحمد - خطة الهيكلة (المرحلة 1)

## الفكرة العامة
أحمد = Agent مدير، يتوسع لاحقاً ليدير موظفين تحته (رهف - عقار، نورة - مالي، فهد - تداول منفصل).
**نبدأ بأحمد لحاله فقط**، بدون موظفين، للتأكد إنه يشتغل صح أول.

## المكونات التقنية (المرحلة 1)

### 1. المشروع
- Next.js 14 (App Router)
- Supabase (قاعدة بيانات + مصادقة لاحقاً)
- Anthropic API (Claude) عبر API Route في Next.js

### 2. قاعدة البيانات (Supabase) - 3 جداول فقط للبداية

**جدول `ahmed_conversations`** (سجل المحادثات الخام)
- id (uuid, primary key)
- role (text: 'user' أو 'assistant')
- content (text)
- created_at (timestamp)

**جدول `ahmed_memory`** (الحقائق المهمة المستخلصة - تشبه noura_memory)
- id (uuid, primary key)
- key (text) - مثلاً "الهدف_الحالي" أو "معلومة_مهمة"
- value (text)
- updated_at (timestamp)

**جدول `ahmed_tasks`** (المهام اللي أحمد يتابعها - اختياري بالبداية، نضيفه بعدين)

### 3. هيكل الملفات (Next.js)
```
ahmed-project/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts       ← نقطة الاتصال بـ Claude API
│   ├── page.tsx                ← واجهة المحادثة البسيطة
│   └── layout.tsx
├── lib/
│   ├── supabase.ts             ← اتصال Supabase
│   └── system-prompt.ts        ← "شخصية" أحمد (System Prompt)
├── .env.local                  ← المفاتيح السرية (Anthropic + Supabase)
└── package.json
```

## خطوات البناء (بالترتيب)

1. ✅ تجهيز قاعدة البيانات (SQL Schema) ← **الخطوة الحالية**
2. إنشاء مشروع Next.js وربطه بـ Supabase
3. كتابة System Prompt لأحمد (هوية + قواعد سلوك)
4. بناء API Route يتصل بـ Claude ويحفظ المحادثة
5. بناء الذاكرة (سحب من ahmed_memory قبل كل رد + تحديثها)
6. واجهة بسيطة للمحادثة
7. اختبار شامل
8. **بعدها فقط:** نضيف أول موظف (رهف)

## ملاحظة مهمة
كل خطوة نبنيها ونختبرها **قبل** ننتقل للي بعدها - ما نبني كل شي دفعة وحدة.
