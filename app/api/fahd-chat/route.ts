import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { FAHD_SYSTEM_PROMPT } from '@/lib/fahd-system-prompt';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// يستخرج رموز الأسهم المذكورة برسالة المستخدم (مثل NVDA, TSLA, AAPL)
function extractTickers(text: string): string[] {
  const matches = text.match(/\b[A-Z]{1,5}\b/g) || [];
  const ignore = ['API', 'ETF', 'CEO', 'AI', 'USA', 'US', 'RSI', 'EMA', 'SMA', 'VWAP', 'MACD', 'VIX'];
  return [...new Set(matches.filter((t) => !ignore.includes(t)))].slice(0, 3);
}

// يجيب سعر سهم من Finnhub
async function getQuote(symbol: string, apiKey: string) {
  try {
    const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    return `${symbol}: السعر الحالي $${d.c} | التغير اليومي ${d.dp?.toFixed(2)}% | أعلى اليوم $${d.h} | أدنى اليوم $${d.l} | الافتتاح $${d.o} | إغلاق أمس $${d.pc}`;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'الرسالة مطلوبة' }, { status: 400 });
    }

    // 1. اجلب ذاكرة فهد طويلة المدى
    const { data: memoryRows } = await supabase
      .from('fahd_memory')
      .select('key, value')
      .order('updated_at', { ascending: false });
    const memoryContext = (memoryRows || [])
      .map((row) => `- ${row.key}: ${row.value}`)
      .join('\n');

    // 2. اجلب آخر 10 رسائل من محادثات فهد
    const { data: recentMessages } = await supabase
      .from('fahd_conversations')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(10);
    const conversationHistory = (recentMessages || []).reverse();

    // 3. اجلب بيانات السوق الحية من Finnhub
    let marketData = '';
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      const tickers = extractTickers(message);
      // المؤشرات الرئيسية عبر ETFs الممثلة لها + أي أسهم مذكورة بالرسالة
      const symbols = [...new Set(['SPY', 'QQQ', ...tickers])];
      const results = await Promise.all(symbols.map((s) => getQuote(s, finnhubKey)));
      const lines = results.filter(Boolean);
      if (lines.length > 0) {
        marketData = `\n\n# بيانات السوق الحية (من Finnhub - محدثة الآن):\n(ملاحظة: SPY يمثل مؤشر S&P 500 و QQQ يمثل NASDAQ 100)\n${lines.join('\n')}`;
      }
    }

    // 4. ابنِ الـ System Prompt النهائي
    let fullSystemPrompt = FAHD_SYSTEM_PROMPT;
    if (memoryContext) {
      fullSystemPrompt += `\n\n# معلومات محفوظة عن تداولات يزيد:\n${memoryContext}`;
    }
    if (marketData) {
      fullSystemPrompt += marketData;
    }

    // 5. جهّز الرسائل بصيغة Anthropic API
    const messages = [
      ...conversationHistory.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    // 6. اتصل بـ Claude
    const response
