# نشر مشروع أحمد - آخر خطوتين

كل الكود جاهز والـ Backend (Supabase) مربوط ومنفذ بالفعل. باقي عليك بس:

## الخطوة 1: ارفع الكود على GitHub

### أ) لو ما عندك حساب GitHub
روح إلى github.com وسجل حساب مجاني (بريد إلكتروني + كلمة مرور، دقيقتين بس).

### ب) أنشئ مستودع (Repository) فاضي
1. بعد تسجيل الدخول، اضغط على زر **+** أعلى الصفحة → **New repository**
2. اكتب الاسم: `ahmed-agent`
3. خله **Private** (خاص، أفضل لمشروع فيه مفاتيح حساسة)
4. **لا تفعّل** خيار "Add a README file"
5. اضغط **Create repository**
6. بعد الإنشاء، بيوريك GitHub رابط المستودع بهذا الشكل:
   `https://github.com/اسم_حسابك/ahmed-agent.git`
   احتفظ فيه، بتحتاجه بالخطوة الجاية.

### ج) فك ضغط الملف وارفعه من جهازك
1. نزّل ملف `ahmed-project.zip` وفكه في أي مكان بجهازك (مثلاً سطح المكتب)
2. افتح برنامج الطرفية:
   - **ماك**: افتح تطبيق Terminal
   - **ويندوز**: افتح Command Prompt أو PowerShell
3. لازم يكون عندك Git مثبت على جهازك. تأكد بكتابة:
   ```bash
   git --version
   ```
   لو ظهر رقم إصدار، تمام. لو ظهر خطأ "not found"، نزّل Git من git-scm.com أول (تثبيت عادي، Next Next Finish).

4. روح لمجلد المشروع اللي فككته (غيّر المسار حسب مكانه عندك):
   ```bash
   cd Desktop/ahmed-project
   ```

5. نفّذ الأوامر التالية **واحد واحد**، بالترتيب:
   ```bash
   git init
   git add .
   git commit -m "أحمد - النسخة الأولى"
   git branch -M main
   git remote add origin https://github.com/<اسم_حسابك>/ahmed-agent.git
   git push -u origin main
   ```
   (غيّر `<اسم_حسابك>` باسم حسابك الفعلي في GitHub، من الرابط اللي حفظته بالخطوة ب)

6. أول مرة، GitHub بيطلب منك تسجيل دخول (نافذة متصفح تفتح تلقائياً أو يطلب Username + Personal Access Token بدل كلمة المرور العادية). اتبع التعليمات اللي تظهر لك.

7. لو كل شي تمام، آخر سطر بيطلع لك رسالة فيها `main -> main` بدون أخطاء حمراء — معناها الكود رفع بنجاح، وتقدر تتأكد بفتح صفحة المستودع على GitHub وتشوف الملفات فيها.

## الخطوة 2: استورد المشروع في Vercel

1. روح إلى vercel.com → **Add New Project**
2. اختر مستودع `ahmed-agent` اللي رفعته
3. **قبل الضغط على Deploy**، أضف متغيرات البيئة التالية (Environment Variables):

| المتغير | القيمة |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ltvyevadhyxtdfvxeqkd.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0dnlldmFkaHl4dGRmdnhlcWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MzYwMTUsImV4cCI6MjA5OTAxMjAxNX0.69ALrYpgTeDgJMAe6Ojzxw95_7ITg2eKIFp-6fXCjhw` |
| `ANTHROPIC_API_KEY` | *(من حسابك في console.anthropic.com → API Keys)* |

4. اضغط **Deploy**

بعد دقيقة أو دقيقتين، بيصير عندك رابط زي `ahmed-agent.vercel.app` وأحمد يشتغل فعلياً.

---

## ملاحظة مهمة عن ANTHROPIC_API_KEY
هذا المفتاح الوحيد اللي لازم تجيبه أنت بنفسك (ما أقدر أنشئه لك لأنه مرتبط بحسابك وبياناتك المالية في Anthropic Console). اذا ما عندك وحده، سجل بـ console.anthropic.com وأنشئ مفتاح جديد من صفحة API Keys.

---

قولي لما تخلص هالخطوتين، وأتابع معاك أي خطأ يطلع أو نكمل للخطوة الجاية (إضافة رهف).
