import { NextRequest, NextResponse } from 'next/server';

// ============================================
// يستدعي Supabase Edge Function بدل الاتصال المباشر
// لا حاجة لأي مفتاح سري هنا إطلاقًا
// المفتاح أدناه هو anon/publishable — آمن بطبيعته، مصمم للكشف العلني
// ============================================

const EDGE_FUNCTION_URL = 'https://mxjwwdedtfbksitobjhj.supabase.co/functions/v1/staging-data';
const STAGING_ANON_KEY = 'sb_publishable_bpcBIkH46LP9h9nBpwCqOg_PD3XWhrJ';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${STAGING_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    return NextResponse.json(result, { status: response.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
