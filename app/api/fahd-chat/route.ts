import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { FAHD_SYSTEM_PROMPT } from '@/lib/fahd-system-prompt';
import { executeBacktest } from '@/lib/run-backtest';
import { getOptionsExpirations, getOptionsChain } from '@/lib/tradier';
import { getTechnicalIndicators } from '@/lib/market-indicators';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function extractTickers(text: string): string[] {
  const matches = text.match(/\b[A-Z]{1,5}\b/g) || [];
  const ignore = ['API', 'ETF', 'CEO', 'AI', 'USA', 'US', 'RSI', 'EMA', 'SMA', 'VWAP', 'MACD', 'VIX', 'SPY', 'QQQ', 'A', 'B', 'C', 'D'];
  return [...new Set(matches.filter((t) => !ignore.includes(t)))].slice(0, 2);
}

async function getQuote(symbol: string, apiKey: string) {
  try {
    const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`, { cache: 'no-store' });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(`Finnhub quote HTTP error for ${symbol}: status=${res.status} body=${bodyText}`);
      return null;
    }
    const d = await res.json();
    if (!d.c || d.c === 0) {
      console.error(`Finnhub quote empty/zero for ${symbol}: ${JSON.stringify(d)}`);
      return null;
    }
    return `${symbol}: السعر $${d.c} | التغير اليومي ${d.dp?.toFixed(2)}% | أعلى اليوم $${d.h} | أدنى اليوم $${d.l} | الافتتاح $${d.o} | إغلاق أمس $${d.pc}`;
  } catch (e: any) {
    console.error(`Finnhub quote fetch threw for ${symbol}: ${e?.message || e}`);
    return null;
  }
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

// آخر 3 أخبار مهمة للسهم خلال 5 أيام
async function getCompanyNews(symbol: string, apiKey: string) {
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 5 * 24 * 60 * 60 * 1000);
    const res = await fetch(
      `${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${formatDate(from)}&to=${formatDate(to)}&token=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return null;
    const top = items.slice(0, 3);
    const lines = top.map((n: any) => {
      const date = new Date(n.datetime * 1000).toISOString().split('T')[0];
      return `  - [${date}] ${n.headline} (المصدر: ${n.source})`;
    });
    return `أخبار ${symbol} الأخيرة:\n${lines.join('\n')}`;
  } catch (e: any) {
    console.error(`Finnhub company-news fetch threw for ${symbol}: ${e?.message || e}`);
    return null;
  }
}

// تحقق هل فيه إعلان أرباح خلال الـ14 يوم الجاية (مهم جداً لمتداولي الخيارات)
async function getUpcomingEarnings(symbol: string, apiKey: string) {
  try {
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    const res = await fetch(
      `${FINNHUB_BASE}/calendar/earnings?from=${formatDate(from)}&to=${formatDate(to)}&symbol=${symbol}&token=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.earningsCalendar;
    if (!Array.isArray(items) || items.length === 0) return null;
    const next = items[0];
    return `⚠️ ${symbol} عندها إعلان أرباح متوقع بتاريخ ${next.date} (${next.hour === 'bmo' ? 'قبل الافتتاح' : next.hour === 'amc' ? 'بعد الإغلاق' : 'وقت غير محدد'}) - توقّع تقلب أعلى من المعتاد حول هذا التاريخ.`;
  } catch (e: any) {
    console.error(`Finnhub earnings calendar fetch threw for ${symbol}: ${e?.message || e}`);
    return null;
  }
}

// أخبار السوق العامة (اقتصاد كلي، لا ترتبط بسهم معين) - آخر 4 عناوين
async function getGeneralMarketNews(apiKey: string) {
  try {
    const res = await fetch(`${FINNHUB_BASE}/news?category=general&token=${apiKey}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return null;
    const top = items.slice(0, 4);
    const lines = top.map((n: any) => {
      const date = new Date(n.datetime * 1000).toISOString().split('T')[0];
      return `  - [${date}] ${n.headline} (${n.source})`;
    });
    return `أخبار السوق العامة (اقتصاد كلي):\n${lines.join('\n')}`;
  } catch (e: any) {
    console.error(`Finnhub general news fetch threw: ${e?.message || e}`);
    return null;
  }
}

// أحداث اقتصادية مهمة قادمة خلال 7 أيام (فائدة، تضخم، وظائف...الخ)
async function getEconomicCalendar(apiKey: string) {
  try {
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const res = await fetch(
      `${FINNHUB_BASE}/calendar/economic?from=${formatDate(from)}&to=${formatDate(to)}&token=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.economicCalendar;
    if (!Array.isArray(items) || items.length === 0) return null;
    // نركز بس على الأحداث عالية التأثير (impact = 2 أو 3 عادة بمقياس Finnhub)
    const important = items.filter((e: any) => (e.impact ?? 0) >= 2).slice(0, 5);
    if (important.length === 0) return null;
    const lines = important.map((e: any) => `  - [${e.date}] ${e.event} (${e.country || ''})`);
    return `أحداث اقتصادية مهمة قادمة (7 أيام):\n${lines.join('\n')}`;
  } catch (e: any) {
    console.error(`Finnhub economic calendar fetch threw: ${e?.message || e}`);
    return null;
  }
}

// ============================================
// أداة الباك-تست: تعريف الأداة اللي فهد يقدر يستدعيها بنفسه
// ============================================
const TOOLS = [
  {
    name: 'get_technical_indicators',
    description:
      'يحسب مؤشرات فنية لسهم معين: RSI (تشبع شرائي/بيعي)، MACD (زخم واتجاه)، Bollinger Bands (تذبذب)، ومستويات دعم/مقاومة تقريبية. استخدمها لما يزيد يسأل عن تحليل فني، أو يسأل عن مؤشر محدد (RSI، MACD، دعم، مقاومة) لسهم.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'رمز السهم الأمريكي، مثل AAPL أو TSLA' },
        timeframe: {
          type: 'string',
          description: 'الفريم الزمني. الافتراضي 1day (يومي).',
          enum: ['15min', '1h', '4h', '1day', '1week'],
        },
      },
      required: ['symbol'],
    },
  },
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
// فلتر سريع بدون AI: هل الرسالة يُحتمل تحتوي معلومة تستحق الحفظ؟
// يشتغل قبل أي استدعاء لـ Claude، عشان نوفر الوقت والتكلفة لمعظم الرسائل العادية
function mightContainSaveworthyInfo(userMessage: string): boolean {
  const signals = [
    /\d/, // أي رقم (سعر، نسبة، كمية)
    /دخلت|خرجت|صفقة|قاعدة|تعلمت|درس|أفضل\s*ما|ما\s*أدخل|ما\s*أدخل\s*قبل|وقف\s*خسارة|هدف\s*ربح/,
  ];
  return signals.some((re) => re.test(userMessage));
}

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
      // نشمل آخر رسائل يزيد بالبحث عن الرمز، مو بس الرسالة الحالية،
      // عشان لو سأل بالسياق ("وش سعره؟") بعد ما ذكر الرمز برسالة سابقة
      const recentUserText = conversationHistory
        .filter((m: { role: string; content: string }) => m.role === 'user')
        .slice(-4)
        .map((m: { content: string }) => m.content)
        .join(' ');
      const currentTickers = extractTickers(message);
      const historyTickers = extractTickers(recentUserText).filter((t) => !currentTickers.includes(t));
      const tickers = [...currentTickers, ...historyTickers].slice(0, 3);
      const quoteSymbols = [...new Set(['SPY', 'QQQ', ...tickers])];
      const quoteResults = await Promise.all(quoteSymbols.map((s) => getQuote(s, finnhubKey)));
      const quoteLines = quoteResults.filter(Boolean);
      if (quoteLines.length > 0) {
        marketData = `\n\n# بيانات السوق الحية (من Finnhub - محدثة الآن):\n(ملاحظة: SPY يمثل S&P 500 و QQQ يمثل NASDAQ 100)\n${quoteLines.join('\n')}`;
      } else {
        console.error(`No quotes returned at all for symbols: ${quoteSymbols.join(',')}`);
      }

      // أخبار وتقويم أرباح - بس للأسهم المحددة (مو SPY/QQQ) عشان نتجنب طلبات زايدة
      if (tickers.length > 0) {
        const newsResults = await Promise.all(tickers.map((s) => getCompanyNews(s, finnhubKey)));
        const earningsResults = await Promise.all(tickers.map((s) => getUpcomingEarnings(s, finnhubKey)));
        const newsLines = newsResults.filter(Boolean);
        const earningsLines = earningsResults.filter(Boolean);
        if (newsLines.length > 0) {
          marketData += `\n\n# أخبار حديثة (من Finnhub):\n${newsLines.join('\n')}`;
        }
        if (earningsLines.length > 0) {
          marketData += `\n\n# تنبيهات أرباح قريبة:\n${earningsLines.join('\n')}`;
        }
      }

      // أخبار كلية وتقويم اقتصادي - دائماً، بغض النظر عن السهم المذكور
      const [generalNews, econCalendar] = await Promise.all([
        getGeneralMarketNews(finnhubKey),
        getEconomicCalendar(finnhubKey),
      ]);
      if (generalNews) marketData += `\n\n# ${generalNews}`;
      if (econCalendar) marketData += `\n\n# ${econCalendar}`;
    } else {
      console.error('FINNHUB_API_KEY is missing from environment variables');
    }

    let fullSystemPrompt = FAHD_SYSTEM_PROMPT;
    fullSystemPrompt += `\n\n# قدرة إضافية: الأخبار وتقويم الأرباح\nلو وصلتك أخبار حديثة أو تنبيه أرباح قريبة عن سهم يزيد يسأل عنه، اذكرها له مختصرة ضمن تحليلك - خصوصاً تنبيه الأرباح، لأنه مهم جداً لمتداولي الخيارات (التقلب يرتفع كثير حول تاريخ الإعلان). لا تتجاهلها حتى لو ما سأل عنها صراحة.`;
    fullSystemPrompt += `\n\n# قدرة إضافية: المؤشرات الفنية\nعندك أداة get_technical_indicators تحسب RSI وMACD وBollinger Bands ودعم/مقاومة لأي سهم. استخدمها لما يزيد يسأل عن تحليل فني أو مؤشر محدد. اشرح له الإشارات بالعربي البسيط (مثلاً: RSI فوق 70 يعني تشبع شرائي، ممكن يصحح). لا تعتبر إشارة واحدة كافية للقرار - اربطها بسياق باقي التحليل.`;
    fullSystemPrompt += `\n\n# قدرة إضافية: الأخبار الكلية والتقويم الاقتصادي\nبيوصلك بمعلومات السوق تلقائياً أخبار اقتصادية عامة وأحداث اقتصادية مهمة قادمة (فائدة، تضخم، وظائف). اذكرها لما تكون مرتبطة بسؤال يزيد أو مؤثرة على قراره، خصوصاً لو فيه حدث كبير قريب (زي قرار فائدة) قد يفجّر تقلب السوق كامل.`;
    fullSystemPrompt += `\n\n# قدرة إضافية: اختبار الاستراتيجيات (Backtest)\nعندك أداة run_backtest تقدر تستدعيها لما يزيد يسأل عن أداء استراتيجية أو نتيجة باك-تست لسهم معين. بعد ما ترجع النتيجة، لخّصها له بالعربي بشكل واضح: عدد الصفقات، نسبة النجاح، العائد الكلي، وأقصى انخفاض. ذكّره دائماً إن العينات الصغيرة (أقل من 20-30 صفقة) مؤشر ضعيف الموثوقية. ملاحظتين مهمتين: (1) العائد المحسوب يخصم تقديرياً عمولة وانزلاق سعري بسيط، فهو أقرب للواقع مو مثالي 100%. (2) لو آخر صفقة فيها autoClosedAtEnd=true، وضّح له إنها أُغلقت افتراضياً لانتهاء بيانات الفترة مو بإشارة خروج حقيقية، وممكن نتيجتها تختلف لو مدّينا الفترة.`;
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
        if (block.name === 'get_technical_indicators') {
          const output = await getTechnicalIndicators(block.input.symbol, block.input.timeframe);
          collectedToolResults.push({ name: 'get_technical_indicators', input: block.input, output });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output),
          });
        } else if (block.name === 'run_backtest') {
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

    // الحفظ التلقائي للذاكرة طويلة المدى - بس لو الفلتر السريع اشتبه فيها،
    // عشان نتجنب استدعاء Claude إضافي على كل رسالة عادية
    if (mightContainSaveworthyInfo(message)) {
      await autoSaveMemory(message, assistantText);
    }

    return NextResponse.json({ reply: assistantText, toolResults: collectedToolResults });
  } catch (error) {
    console.error('Fahd chat route error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
