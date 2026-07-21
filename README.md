# Fahd Golden Options Scanner

انسخ الملفين إلى مشروع AhmedAI بنفس المسارات:

- `lib/trading/opportunity-scanner.ts`
- `app/api/scan-opportunities/route.ts`

ثم شغّل:

```bash
npm run build
git add lib/trading/opportunity-scanner.ts app/api/scan-opportunities/route.ts
git commit -m "Add golden options opportunity scanner"
git push origin main
```

بعد نشر Vercel:

- GET `/api/scan-opportunities` لفحص جاهزية الخدمة.
- POST `/api/scan-opportunities` لإرسال قائمة العقود المرشحة.

المحرك:
- يفحص حتى 500 عقد.
- يستبعد العقود الضعيفة.
- يرتب أفضل 5 فرص.
- يصنف الفرص إلى GOLD أو STRONG أو WATCH.
- يشترط توافق السوق والسهم وجودة العقد والتفعيل.
