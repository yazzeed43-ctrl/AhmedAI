import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { FAHD_SYSTEM_PROMPT } from '@/lib/fahd-system-prompt';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function extractTickers(text: string): string[] {
  const matches = text.match(/\b[A-Z]{1,5}\b/g) || [];
  const ignore = ['API', 'ETF', 'CEO', 'AI', 'USA', 'US', 'RSI', 'EMA', 'SMA', 'VWAP', 'MACD', 'VIX', 'SPY', 'QQQ', 'A', 'B', 'C', 'D'];
  return [...new Set(matches.filter((t) => !ignore.includes(t)))].slice(0, 2);
}

async function getQuote(symbol: string, apiKey: string) {
  try {
    const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.c || d.c === 0) return null;
    return `${symbol}: السعر $${d.c} | التغير اليومي ${d.dp?.toFixed(2)}% | أعلى اليوم $${d.h} | أدنى اليوم $${d.l} | الافتتاح $${d.o} | إغلاق أمس $${d.pc}`;
  } catch {
    return null;
  }
}

// حفظ تلقائي: يسأل Claude إذا كانت رسالة يزيد تحتوي معلومة تستحق الحفظ الدائم
async function autoSaveMemory(userMessage: string, assistantReply: string) {
  try {
    const checkRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: `أنت نظام فرز للذاكرة طويلة المدى لمساعد تداول. مهمتك: تحديد إذا كانت رسالة المستخدم تحتوي معلومة تستحق الحفظ الدائم.

يستحق الحفظ فقط:
- صفقة فعلية (دخول/خروج بسعر محدد)
- قاعدة تداول شخصية ("ما أدخل قبل FOMC")
- درس مستفاد من خطأ أو نجاح
- تفضيل دائم (أسهم معينة، أسلوب معين، حجم مخاطرة)
- معلومة شخصية مهمة تؤثر على التداول

لا يستحق الحفظ: أسئلة عامة، طلبات تحليل، دردشة، معلومات مؤقتة.

إذا وجدت معلومة تستحق الحفظ، رد بصيغة JSON فقط:
{"save": true, "key": "عنوان_مختصر_بالعربي", "value": "المعلومة كاملة بجملة واضحة"}

إذا لا يوجد شيء يستحق:
{"save": false}

رد بـ JSON فقط بدون أي نص إضافي.`,
        messages: [
          { role: 'user', content: `رسالة يزيد: "${userMessage}"` },
        ],
      }),
    });
    if (!checkRes.ok) return;
    const checkData = await checkRes.json();
    const rawText = checkData.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.save && parsed.key && parsed.value) {
      await supabase.from('fahd_memory').insert({
        key: parsed.key,
        value: parsed.value,
      });
    }
  } catch {
    // فشل الحفظ التلقائي لا يوقف المحادثة
  }
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'الرسالة مطلوبة' }, { status: 400 });
    }

    const { data: memoryRows } = await supabase
      .from('fahd_memory')
      .select('key, value')
      .order('updated_at', { ascending: false })
      .limit(50);
    const memoryContext = (memoryRows || [])
      .map((row) => `- ${row.key}: ${row.value}`)
      .join('\n');

    const { data: recentMessages } = await supabase
      .from('fahd_conversations')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(10);
    const conversationHistory = (recentMessages || []).reverse();

    let marketData = '';
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      const tickers = extractTickers(message);
      const quoteSymbols = [...new Set(['SPY', 'QQQ', ...tickers])];
      const quoteResults = await Promise.all(quoteSymbols.map((s) => getQuote(s, finnhubKey)));
      const quoteLines = quoteResults.filter(Boolean);
      if (quoteLines.length > 0) {
        marketData = `\n\n# بيانات السوق الحية (من Finnhub - محدثة الآن):\n(ملاحظة: SPY يمثل S&P 500 و QQQ يمثل NASDAQ 100)\n${quoteLines.join('\n')}`;
      }
    }

    let fullSystemPrompt = FAHD_SYSTEM_PROMPT;
    if (memoryContext) {
      fullSystemPrompt += `\n\n# ذاكرتك طويلة المدى عن يزيد وتداولاته:\n${memoryContext}`;
    }
    if (marketData) {
      fullSystemPrompt += marketData;
    }

    const messages = [
      ...conversationHistory.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: fullSystemPrompt,
        messages,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return NextResponse.json({ error: 'فشل الاتصال بالنموذج' }, { status: 500 });
    }
    const data = await response.json();
    const assistantText = data.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('\n');

    await supabase.from('fahd_conversations').insert([
      { role: 'user', content: message },
      { role: 'assistant', content: assistantText },
    ]);

    // الحفظ التلقائي للذاكرة طويلة المدى (بدون انتظار)
    await autoSaveMemory(message, assistantText);

    return NextResponse.json({ reply: assistantText });
  } catch (error) {
    console.error('Fahd chat route error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
