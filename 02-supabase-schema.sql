-- ==============================================
-- مشروع أحمد - جداول قاعدة البيانات (المرحلة 1)
-- ينفذ هذا الملف في Supabase SQL Editor
-- ==============================================

-- جدول 1: سجل المحادثات الخام
CREATE TABLE ahmed_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- جدول 2: الذاكرة طويلة المدى (الحقائق المستخلصة)
CREATE TABLE ahmed_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- فهرس عشان البحث بالذاكرة يكون سريع
CREATE INDEX idx_ahmed_memory_key ON ahmed_memory(key);

-- فهرس عشان نجيب آخر المحادثات بسرعة (ترتيب زمني)
CREATE INDEX idx_ahmed_conversations_created_at ON ahmed_conversations(created_at DESC);

-- ==============================================
-- ملاحظة: جدول ahmed_tasks راح نضيفه بمرحلة لاحقة
-- لما نحتاج فعلياً نتتبع مهام، مو من أول يوم
-- ==============================================
