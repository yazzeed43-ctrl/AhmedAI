const Module = require("module");
const path = require("path");

// نواة مشتركة يستخدمها أي محمّل اختبار محدد لحل استيرادات "@/..."
// وقت node --test فقط (bundler resolution خاص بـNext.js لا يترجَم
// تلقائيًا بمخرجات tsc العادية). كل مجموعة اختبار عندها outDir مختلف،
// فيمرَّر اسمه كوسيط بدل قراءة متغير بيئة — يبقى كل سكربت npm بسيطًا
// وبدون صيغة شل خاصة بويندوز/لينكس.
module.exports = function registerPathAlias(outDir) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??=
    "https://placeholder.supabase.co";

  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder";

  const compiledRoot = path.resolve(__dirname, "..", "..", outDir);
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function (
    request,
    parent,
    isMain,
    options
  ) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const mappedRequest = path.join(compiledRoot, request.slice(2));
      return originalResolveFilename.call(
        this,
        mappedRequest,
        parent,
        isMain,
        options
      );
    }

    return originalResolveFilename.call(
      this,
      request,
      parent,
      isMain,
      options
    );
  };
};
