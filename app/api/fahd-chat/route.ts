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

// حساب EMA
function calcEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// حساب SMA
function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// حساب RSI 14
function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

// يجيب الشموع التاريخية ويحسب المؤشرات
async function getTechnicals(symbol: string, apiKey: string) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 200 * 24 * 60 * 60; // آخر 200 يوم لدقة SMA 50
    const res = await fetch(
      `${FINNHUB_BASE}/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${now}&token=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (d.s !== 'ok' || !d.c || d.c.length < 20) return null;

    const closes: number[] = d.c;
    const highs: number[] = d.h;
    const lows: number[] = d.l;
    const volumes: number[] = d.v;

    const last30High = Math.max(...highs.slice(-30));
    const last30Low = Math.min(...lows.slice(-30));
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const sma50 = calcSMA(closes, 50);
    const rsi = calcRSI(closes);
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = volumes[volumes.length - 1];
    const rvol = avgVol > 0 ? lastVol / avgVol : null;
    const current = closes[closes.length - 1];

    const lines = [`# المؤشرات الفنية لـ ${symbol} (محسوبة من بيانات ${closes.length} يوم):`];
    if (ema9) lines.push(`- EMA 9: $${ema9.toFixed(2)} (السعر ${current > ema9 ? 'فوقه ✅' : 'تحته ⚠️'})`);
    if (ema21) lines.push(`- EMA 21: $${ema21.toFixed(2)} (السعر ${current > ema21 ? 'فوقه ✅' : 'تحته ⚠️'})`);
    if (sma50) lines.push(`- SMA 50: $${sma50.toFixed(2)} (السعر ${current > sma50 ? 'فوقه ✅' : 'تحته ⚠️'})`);
    if (rsi) lines.push(`- RSI 14: ${rsi.toFixed(1)} ${rsi > 70 ? '(تشبع شرائي ⚠️)' : rsi < 30 ? '(تشبع بيعي)' : '(محايد)'}`);
    lines.push(`- أعلى 30 يوم (مقاومة تقريبية): $${last30High.toFixed(2)}`);
    lines.push(`- أدنى 30 يوم (دعم تقريبي): $${last30Low.toFixed(2)}`);
    if (rvol) lines.push(`- الحجم النسبي RVOL: ${rvol.toFixed(2)} ${rvol > 1.5 ? '(حجم أعلى من المعتاد - اهتمام قوي)' : rvol < 0.7 ? '(حجم ضعيف)' : '(طبيعي)'}`);

    return lines.join('\n');
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

    const { data: memoryRows } = await supabase
      .from('fahd_memory')
      .select('key, value')
      .order('updated_at', { ascending: false });
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

      // المؤشرات الفنية للأسهم المذكورة فقط (مو المؤشرات العامة)
      const techResults = await Promise.all(tickers.map((s) => getTechnicals(s, finnhubKey)));
      const techLines = techResults.filter(Boolean);

      if (quoteLines.length > 0 || techLines.length > 0) {
        marketData = `\n\n# بيانات السوق الحية (من Finnhub - محدثة الآن):\n(ملاحظة: SPY يمثل S&P 500 و QQQ يمثل NASDAQ 100)\n${quoteLines.join('\n')}`;
        if (techLines.length > 0) {
          marketData += `\n\n${techLines.join('\n\n')}`;
        }
      }
    }

    let fullSystemPrompt = FAHD_SYSTEM_PROMPT;
    if (memoryContext) {
      fullSystemPrompt += `\n\n# معلومات محفوظة عن تداولات يزيد:\n${memoryContext}`;
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

    return NextResponse.json({ reply: assistantText });
  } catch (error) {
    console.error('Fahd chat route error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
