import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// ============================================
// إعداد الاتصال بمشروع Staging فقط
// لا تستخدم هذا الملف مع بيانات alraayed-system الحقيقية
// ============================================
const supabaseStaging = createClient(
  process.env.SUPABASE_STAGING_URL!,
  process.env.SUPABASE_STAGING_SERVICE_KEY!
);

// الجداول المسموح لأحمد يشتغل عليها في هذه المرحلة التجريبية
const ALLOWED_TABLES = ['buildings', 'units', 'tenants', 'contracts', 'payments'];

// العمليات المسموحة فقط: قراءة، إضافة، تعديل
// الحذف (delete) ممنوع تمامًا من هذا الـ endpoint، حتى في staging
const ALLOWED_ACTIONS = ['select', 'insert', 'update'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, table, data, filters } = body;

    // تحقق: الجدول مسموح؟
    if (!ALLOWED_TABLES.includes(table)) {
      return NextResponse.json(
        { error: `الجدول "${table}" غير مسموح. الجداول المتاحة: ${ALLOWED_TABLES.join(', ')}` },
        { status: 403 }
      );
    }

    // تحقق: العملية مسموحة؟
    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `العملية "${action}" غير مسموحة. المسموح فقط: ${ALLOWED_ACTIONS.join(', ')}` },
        { status: 403 }
      );
    }

    let result;

    switch (action) {
      case 'select': {
        let query = supabaseStaging.from(table).select('*');
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            query = query.eq(key, value as string);
          }
        }
        result = await query;
        break;
      }

      case 'insert': {
        if (!data) {
          return NextResponse.json({ error: 'لازم ترسل data للإضافة' }, { status: 400 });
        }
        result = await supabaseStaging.from(table).insert(data).select();
        break;
      }

      case 'update': {
        if (!data || !filters) {
          return NextResponse.json(
            { error: 'لازم ترسل data و filters للتعديل' },
            { status: 400 }
          );
        }
        let query = supabaseStaging.from(table).update(data);
        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value as string);
        }
        result = await query.select();
        break;
      }
    }

    if (result?.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: result?.data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'خطأ غير متوقع' }, { status: 500 });
  }
}

// لا يوجد DELETE handler عن قصد — الحذف ممنوع من هذا المسار بالكامل
