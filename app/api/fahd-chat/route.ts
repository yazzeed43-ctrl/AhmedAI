import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { FAHD_SYSTEM_PROMPT } from '@/lib/fahd-system-prompt';
import { executeBacktest } from '@/lib/run-backtest';
import { getOptionsExpirations, getOptionsChain } from '@/lib/tradier';

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

// ============================================
// أداة الباك-تست: تعريف الأداة اللي فهد يقدر يستدعيها بنفسه
// ============================================
const TOOLS = [
  {
    name: 'run_backtest',
    description:
      'يشغّل اختبار تاريخي (backtest) لاستراتيجية EMA 9/21 + VWAP + تأكيد الحجم على سهم معين، ويرجع عدد الصفقات، نسبة النجاح، العائد الكلي، وأقصى انخفاض. استخدمها لما يزيد يسأل عن أداء استراتيجية أو نتيجة باك-تست لسهم معين.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'رمز السهم الأمريكي، مثل AAPL أو TSLA' },
        timeframe: {
          type: 'string',
          description: 'الفريم الزمني. الافتراضي 15min وهو الأنسب لهالاستراتيجية.',
          enum: ['5min', '15min', '30min', '1h', '4h', '1day'],
        },
        from: { type: 'string', description: 'تاريخ البداية بصيغة YYYY-MM-DD (اختياري)' },
        to: { type: 'string', description: 'تاريخ النهاية بصيغة YYYY-MM-DD (اختياري)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_options_expirations',
    description:
      'يجيب تواريخ استحقاق عقود الخيارات المتاحة لسهم معين. استخدمها أول لما يزيد يسأل عن خيارات سهم ولا يحدد تاريخ استحقاق، عشان تعرف وش التواريخ المتاحة قبل ما تجيب السلسلة.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'رمز السهم الأمريكي، مثل AAPL أو TSLA' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_options_chain',
    description:
      'يجيب سلسلة خيارات كاملة (Calls وPuts) لسهم وتاريخ استحقاق معين، مع الأسعار وGreeks (Delta, Theta, Gamma, Vega, IV) وتقييم جودة السيولة لكل عقد (سبريد، Open Interest، الحجم). ⚠️ بيانات Sandbox متأخرة 15 دقيقة - للتقييم والتجربة فقط، مو لقرار دخول لحظي. لازم تستخدم get_options_expirations أول لو ما عندك تاريخ استحقاق محدد.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'رمز السهم الأمريكي' },
        expiration: { type: 'string', description: 'تاريخ الاستحقاق بصيغة YYYY-MM-DD' },
      },
      required: ['symbol', 'expiration'],
    },
  },
];

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

async function callClaude(messages: any[], systemPrompt: string) {
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
      system: systemPrompt,
      tools: TOOLS,
      messages,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error('Anthropic API error:', errText);
    throw new Error('فشل الاتصال بالنموذج');
  }
  return response.json();
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
    fullSystemPrompt += `\n\n# قدرة إضافية: اختبار الاستراتيجيات (Backtest)\nعندك أداة run_backtest تقدر تستدعيها لما يزيد يسأل عن أداء استراتيجية أو نتيجة باك-تست لسهم معين. بعد ما ترجع النتيجة، لخّصها له بالعربي بشكل واضح: عدد الصفقات، نسبة النجاح، العائد الكلي، وأقصى انخفاض. ذكّره دائماً إن العينات الصغيرة (أقل من 20-30 صفقة) مؤشر ضعيف الموثوقية.`;
    fullSystemPrompt += `\n\n# قدرة إضافية: تقييم عقود الخيارات (Options)\nعندك أداتين: get_options_expirations وget_options_chain. قواعد صارمة يجب اتباعها دائماً:\n1. البيانات من Sandbox متأخرة 15 دقيقة - ذكّر يزيد بهذا في كل مرة تعرض فيها بيانات خيارات.\n2. أنت لا تُوصي بالدخول مباشرة أبداً (لا تقول "ادخل" أو "اشتري الآن"). دورك تقييمي فقط: تعرض جودة العقد، السيولة، المخاطر، وتترك القرار ليزيد بالكامل.\n3. كل عقد يرجع من get_options_chain فيه حقل liquidity_quality وliquidity_reason - اعرضهم دائماً. لو العقد "ضعيف - احذر"، نبّه يزيد بوضوح إنه ممكن يصعب الخروج منه حتى لو التحليل الفني يبدو جيد.\n4. لا تقترح عقداً بسبريد واسع أو سيولة ضعيفة كخيار أساسي - إذا كل العقود بهالتاريخ ضعيفة السيولة، قول ذلك صراحة واقترح تاريخ استحقاق ثاني أو انتظار.`;
    fullSystemPrompt += `\n\n# ملاحظة مهمة عن طريقة الرد بعد استخدام الأدوات\nواجهة يزيد تعرض تلقائياً بطاقة مرئية منسقة بكل الأرقام والتفاصيل بعد أي استدعاء لـ run_backtest أو get_options_chain. لذلك لا تكرر الجدول أو كل الأرقام نصياً في ردك - اكتفِ بتعليق قصير (سطرين إلى ثلاثة أسطر) يعطي رأيك أو أهم ملاحظة، والباقي يزيد بيشوفه بالبطاقة.`;
    if (memoryContext) {
      fullSystemPrompt += `\n\n# ذاكرتك طويلة المدى عن يزيد وتداولاته:\n${memoryContext}`;
    }
    if (marketData) {
      fullSystemPrompt += marketData;
    }

    const workingMessages: any[] = [
      ...conversationHistory.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    // ============================================
    // حلقة تنفيذ الأدوات: لغاية 3 جولات (نفس نمط أحمد)
    // ============================================
    let assistantText = '';
    const collectedToolResults: { name: string; input: any; output: any }[] = [];
    const maxRounds = 4;

    for (let round = 0; round < maxRounds; round++) {
      const data = await callClaude(workingMessages, fullSystemPrompt);
      const toolUseBlocks = data.content.filter((b: any) => b.type === 'tool_use');
      const textBlocks = data.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      if (toolUseBlocks.length === 0) {
        assistantText = textBlocks;
        break;
      }

      // أضف رد المساعد (يحتوي على طلب استخدام الأداة) للمحادثة
      workingMessages.push({ role: 'assistant', content: data.content });

      // نفّذ كل أداة مطلوبة
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (block.name === 'run_backtest') {
          const result = await executeBacktest(block.input);
          collectedToolResults.push({ name: 'run_backtest', input: block.input, output: result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } else if (block.name === 'get_options_expirations') {
          try {
            const dates = await getOptionsExpirations(block.input.symbol);
            const output = { symbol: block.input.symbol, expirations: dates };
            collectedToolResults.push({ name: 'get_options_expirations', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = { error: e.message || 'فشل جلب تواريخ الاستحقاق' };
            collectedToolResults.push({ name: 'get_options_expirations', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_options_chain') {
          try {
            const chain = await getOptionsChain(block.input.symbol, block.input.expiration);
            collectedToolResults.push({ name: 'get_options_chain', input: block.input, output: chain });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(chain),
            });
          } catch (e: any) {
            const output = { error: e.message || 'فشل جلب سلسلة الخيارات' };
            collectedToolResults.push({ name: 'get_options_chain', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: 'أداة غير معروفة' }),
            is_error: true,
          });
        }
      }
      workingMessages.push({ role: 'user', content: toolResults });

      // لو وصلنا آخر جولة وما زال فيه tool_use، خذ أي نص متوفر كحل احتياطي
      if (round === maxRounds - 1) {
        assistantText = textBlocks || 'نفّذت الطلب، بس واجهت صعوبة ألخصه بوضوح. جرب تسأل مرة ثانية.';
      }
    }

    await supabase.from('fahd_conversations').insert([
      { role: 'user', content: message },
      { role: 'assistant', content: assistantText },
    ]);

    // الحفظ التلقائي للذاكرة طويلة المدى (بدون انتظار)
    await autoSaveMemory(message, assistantText);

    return NextResponse.json({ reply: assistantText, toolResults: collectedToolResults });
  } catch (error) {
    console.error('Fahd chat route error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
