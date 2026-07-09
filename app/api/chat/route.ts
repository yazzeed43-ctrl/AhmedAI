import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AHMED_SYSTEM_PROMPT } from '@/lib/system-prompt';

// ============================================
// أداة رهف: تنفيذ عقاري كامل عبر Edge Function
// ============================================
const RAHAF_EDGE_FUNCTION_URL =
  'https://bbxbyuygtazscfhbonls.supabase.co/functions/v1/real-estate-data';
const RAHAF_ANON_KEY = process.env.RAHAF_ANON_KEY!;

const RAHAF_TOOL = {
  name: 'query_real_estate',
  description:
    'استدعِ رهف للحصول على بيانات عقارية فعلية: مباني، وحدات، مستأجرين، عقود، أو دفعات. استخدمها لأي سؤال عن العقارات أو المتأخرات أو الإيجارات.',
  input_schema: {
    type: 'object' as const,
    properties: {
      table: {
        type: 'string',
        enum: ['buildings', 'units', 'tenants', 'contracts', 'payments'],
        description: 'الجدول المطلوب الاستعلام عنه',
      },
      filters: {
        type: 'object',
        description: 'فلاتر اختيارية، مثال: {"building_id": "..."}',
      },
    },
    required: ['table'],
  },
};

async function callRahaf(table: string, filters?: Record<string, string>) {
  const res = await fetch(RAHAF_EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RAHAF_ANON_KEY}`,
    },
    body: JSON.stringify({ action: 'select', table, filters }),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'الرسالة مطلوبة' }, { status: 400 });
    }

    // 1. الذاكرة طويلة المدى
    const { data: memoryRows } = await supabase
      .from('ahmed_memory')
      .select('key, value')
      .order('updated_at', { ascending: false });

    const memoryContext = (memoryRows || [])
      .map((row) => `- ${row.key}: ${row.value}`)
      .join('\n');

    // 2. آخر 10 رسائل
    const { data: recentMessages } = await supabase
      .from('ahmed_conversations')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(10);

    const conversationHistory = (recentMessages || []).reverse();

    const fullSystemPrompt = memoryContext
      ? `${AHMED_SYSTEM_PROMPT}\n\n# معلومات محفوظة عن يزيد وأعماله:\n${memoryContext}`
      : AHMED_SYSTEM_PROMPT;

    const messages: any[] = [
      ...conversationHistory.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    // 3. حلقة الاتصال بـ Claude (تدعم استدعاء الأدوات)
    let assistantText = '';
    let toolRoundsRemaining = 3;

    while (toolRoundsRemaining > 0) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: fullSystemPrompt,
          messages,
          tools: [RAHAF_TOOL],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Anthropic API error:', errText);
        return NextResponse.json({ error: 'فشل الاتصال بالنموذج' }, { status: 500 });
      }

      const data = await response.json();

      const toolUseBlocks = data.content.filter(
        (block: { type: string }) => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        assistantText = data.content
          .filter((block: { type: string }) => block.type === 'text')
          .map((block: { text: string }) => block.text)
          .join('\n');
        break;
      }

      messages.push({ role: 'assistant', content: data.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block: any) => {
          const { table, filters } = block.input;
          const rahafResult = await callRahaf(table, filters);
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(rahafResult),
          };
        })
      );

      messages.push({ role: 'user', content: toolResults });
      toolRoundsRemaining--;
    }

    // 4. احفظ المحادثة
    await supabase.from('ahmed_conversations').insert([
      { role: 'user', content: message },
      { role: 'assistant', content: assistantText },
    ]);

    return NextResponse.json({ reply: assistantText });
  } catch (error) {
    console.error('Chat route error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
