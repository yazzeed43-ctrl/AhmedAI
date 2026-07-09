import { NextRequest, NextResponse } from 'next/server';

// ============================================
// يستدعي Supabase Edge Function بدل الاتصال المباشر
// ============================================

const EDGE_FUNCTION_URL = 'https://mxjwwdedtfbksitobjhj.supabase.co/functions/v1/staging-data';
const STAGING_ANON_KEY = process.env.STAGING_ANON_KEY!;

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
