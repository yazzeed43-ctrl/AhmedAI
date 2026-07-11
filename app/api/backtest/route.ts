import { NextRequest, NextResponse } from 'next/server';
import { executeBacktest } from '@/lib/run-backtest';

// ============================================
// POST /api/backtest
// body: { symbol: string, timeframe?: string, from?: string, to?: string }
// يشتغل لأي رمز سهم يُدخل - عام بالكامل
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const output = await executeBacktest(body);

    if ('error' in output) {
      return NextResponse.json(output, { status: 404 });
    }

    return NextResponse.json(output);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
