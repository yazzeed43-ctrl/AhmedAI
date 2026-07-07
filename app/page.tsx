'use client';

import { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: 700,
        margin: '0 auto',
        background: '#0f0f10',
        color: '#f5f0e6',
      }}
    >
      <header
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #2a2a2a',
          fontSize: 20,
          fontWeight: 'bold',
          color: '#d4af37',
        }}
      >
        أحمد
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {messages.length === 0 && (
          <p style={{ color: '#888', textAlign: 'center', marginTop: 40 }}>
            ابدأ المحادثة مع أحمد...
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-start' : 'flex-end',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: 12,
                background: m.role === 'user' ? '#1e1e1e' : '#d4af37',
                color: m.role === 'user' ? '#f5f0e6' : '#0f0f10',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ color: '#888', fontSize: 14 }}>أحمد يكتب...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          display: 'flex',
          padding: 16,
          borderTop: '1px solid #2a2a2a',
          gap: 8,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="اكتب رسالتك..."
          style={{
            flex: 1,
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1a1a1a',
            color: '#f5f0e6',
            fontSize: 15,
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          style={{
            padding: '12px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#d4af37',
            color: '#0f0f10',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          إرسال
        </button>
      </div>
    </div>
  );
}
