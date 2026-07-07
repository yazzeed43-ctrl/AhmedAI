import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AHMED_SYSTEM_PROMPT } from '@/lib/system-prompt';

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'الرسالة مطلوبة' }, { status: 400 });
    }

    // 1. اجلب الذاكرة طويلة المدى (كل الحقائق المحفوظة)
    const { data: memoryRows } = await supabase
      .from('ahmed_memory')
      .select('key, value')
      .order('updated_at', { ascending: false });

    const memoryContext = (memoryRows || [])
      .map((row) => `- ${row.key}: ${row.value}`)
      .join('\n');

    // 2. اجلب آخر 10 رسائل من المحادثة (سياق قريب)
    const { data: recentMessages } = await supabase
      .from('ahmed_conversations')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(10);

    const conversationHistory = (recentMessages || []).reverse();

    // 3. ابنِ الـ System Prompt النهائي مع حقن الذاكرة
    const fullSystemPrompt = memoryContext
      ? `${AHMED_SYSTEM_PROMPT}\n\n# معلومات محفوظة عن يزيد وأعماله:\n${memoryContext}`
      : AHMED_SYSTEM_PROMPT;

    // 4. جهّز الرسائل بصيغة Anthropic API
    const messages = [
      ...conversationHistory.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    // 5. اتصل بـ Claude
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

    // 6. احفظ المحادثة (رسالة المستخدم + رد أحمد) في Supabase
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
