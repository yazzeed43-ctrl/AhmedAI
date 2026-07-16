import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// ============================================
// app/api/webhook/tradingview/route.ts
// يستقبل تنبيهات من مؤشر PRO Multi-Tool على TradingView
// (BOOM هابط/صاعد، نمط توافقي) ويخزنها لفهد يستخدمها
// ============================================

const WEBHOOK_SECRET = process.env.TRADINGVIEW_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // تحقق أمني: لازم يجي معه السر المتفق عليه
    if (body.secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { symbol, signal_type, price, timeframe } = body;

    if (!symbol || !signal_type) {
      return NextResponse.json({ error: 'symbol و signal_type مطلوبين' }, { status: 400 });
    }

    const { error } = await supabase.from('tradingview_signals').insert({
      symbol,
      signal_type,
      price: price ?? null,
      timeframe: timeframe ?? null,
      raw_message: JSON.stringify(body),
    });

    if (error) {
      console.error('Failed to save TradingView signal:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('TradingView webhook error:', e);
    return NextResponse.json({ error: e.message || 'خطأ غير متوقع' }, { status: 500 });
  }
}
