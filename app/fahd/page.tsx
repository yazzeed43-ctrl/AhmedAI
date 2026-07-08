'use client';

import { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function FahdPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch('/api/fahd-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });
      const data = await res.json();

      if (data.reply) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'صار خطأ، حاول مرة ثانية.' },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'تعذر الاتصال بالخادم.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d12', color: '#e8e8f0', fontFamily: 'Tahoma, Arial, sans-serif', direction: 'rtl' }}>
      <div style={{ position: 'sticky', top: 0, background: '#111118', borderBottom: '1px solid #1e1e2e', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 10 }}>
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg, #c9a84c, #7a5a1e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#000' }}>ف</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#c9a84c' }}>فهد</div>
          <div style={{ fontSize: 11, color: '#888899' }}>محلل التداول</div>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <a href="/" style={{ padding: '6px 14px', borderRadius: 10, background: '#16161f', border: '1px solid #2a2a3a', color: '#c8c8d4', fontSize: 13, textDecoration: 'none' }}>
            ← أحمد
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.length === 0 && (
          <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 16, padding: '18px 20px', fontSize: 14, lineHeight: 1.9, color: '#c8c8d4' }}>
            أنا فهد، محلل التداول 📈
            <br />
            <br />
            دوري أساعدك تطور نفسك كمتداول - أحلل معك الأسهم والمؤشرات، أعطيك توصية واضحة مع السبب الكامل، وأذكرك دائماً إن القرار والتنفيذ النهائي بيدك انت.
            <br />
            <br />
            وش تحب نحلل اليوم؟
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
            <div
              style={{
                background: m.role === 'user' ? '#16161f' : 'linear-gradient(135deg, #2a3f1e, #1a2e0e)',
                border: `1px solid ${m.role === 'user' ? '#1e1e2e' : '#3d5a1e'}`,
                borderRadius: 16,
                padding: '11px 15px',
                maxWidth: '75%',
                fontSize: 14,
                lineHeight: 1.75,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 16, padding: '11px 15px', width: 60, color: '#888899' }}>
            ...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ position: 'fixed', bottom: 0, width: '100%', background: '#111118', borderTop: '1px solid #1e1e2e', padding: '14px 22px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="اسأل فهد عن سهم أو صفقة..."
            style={{ flex: 1, background: '#16161f', border: '1px solid #1e1e2e', borderRadius: 12, padding: '11px 15px', color: '#e8e8f0', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 14, outline: 'none' }}
          />
          <button onClick={sendMessage} disabled={loading} style={{ width: 44, height: 44, background: '#c9a84c', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 18 }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
