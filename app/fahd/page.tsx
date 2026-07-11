'use client';

import { useState, useRef, useEffect } from 'react';

// ============================================
// أنواع البيانات
// ============================================
type BacktestTrade = {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  returnPct: number;
  reason: string;
  autoClosedAtEnd?: boolean;
};

type BacktestOutput =
  | {
      symbol: string;
      timeframe: string;
      period: { from: string; to: string };
      result: {
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        winRate: number;
        totalReturnPct: number;
        maxDrawdownPct: number;
        trades: BacktestTrade[];
      };
    }
  | { error: string; details?: string | null };

type OptionContract = {
  symbol: string;
  strike: number;
  option_type: 'call' | 'put';
  expiration_date: string;
  bid: number;
  ask: number;
  last: number | null;
  volume: number;
  open_interest: number;
  greeks?: { delta?: number; theta?: number; gamma?: number; vega?: number; mid_iv?: number };
  spread_pct: number | null;
  liquidity_quality: 'جيد' | 'متوسط' | 'ضعيف - احذر';
  liquidity_reason: string;
};

type OptionsChainOutput =
  | {
      symbol: string;
      expiration: string;
      spotPrice: number | null;
      contracts: OptionContract[];
      totalContractsAvailable: number;
      dataDelayNote: string;
    }
  | { error: string };

type ToolResult = { name: string; input: any; output: any };
type Message = { role: 'user' | 'assistant'; content: string; toolResults?: ToolResult[] };
type TickerQuote = { symbol: string; price: number; changePct: number };

// ============================================
// ألوان الهوية (نفس نموذج التصميم المعتمد)
// ============================================
const C = {
  bg: '#0D0E11',
  panel: '#16181D',
  panel2: '#1C1F26',
  border: '#26282E',
  gold: '#C9A227',
  goldDim: '#8A7420',
  text: '#EDEAE3',
  textMuted: '#8B8D93',
  gain: '#2FBF71',
  gainBg: 'rgba(47,191,113,0.12)',
  loss: '#E5484D',
  lossBg: 'rgba(229,72,77,0.12)',
  warn: '#E0A83E',
  warnBg: 'rgba(224,168,62,0.12)',
};

const FONT_AR = "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif";
const FONT_HEAD = "'Cairo', Tahoma, Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

function liquidityStyle(q: string) {
  if (q === 'جيد') return { bg: C.gainBg, color: C.gain };
  if (q === 'متوسط') return { bg: C.warnBg, color: C.warn };
  return { bg: C.lossBg, color: C.loss };
}

// ============================================
// بطاقة نتيجة الباك-تست
// ============================================
function BacktestCard({ output }: { output: BacktestOutput }) {
  if ('error' in output) {
    return (
      <div style={{ background: C.panel2, border: `1px solid ${C.loss}`, borderRadius: 14, padding: 14, fontSize: 12.5, color: C.loss }}>
        ⚠️ {output.error}
        {output.details ? <div style={{ color: C.textMuted, marginTop: 4, fontSize: 11 }}>{output.details}</div> : null}
      </div>
    );
  }

  const { symbol, timeframe, result } = output;
  const smallSample = result.totalTrades < 10;
  const riskRatio =
    result.maxDrawdownPct > 0
      ? `${(result.totalReturnPct / result.maxDrawdownPct).toFixed(2)}x`
      : `غير قابل للقياس — ${result.totalTrades} صفقات فقط`;

  // خط بياني بسيط من نسب العوائد التراكمية
  let cumulative = 1;
  const points = result.trades.map((t) => {
    cumulative *= 1 + t.returnPct / 100;
    return cumulative;
  });
  const allPoints = [1, ...points];
  const min = Math.min(...allPoints);
  const max = Math.max(...allPoints);
  const range = max - min || 1;
  const width = 300;
  const svgPoints = allPoints
    .map((v, i) => {
      const x = (i / (allPoints.length - 1 || 1)) * width;
      const y = 34 - ((v - min) / range) * 30;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14 }}>{symbol} — باك-تست</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, background: 'rgba(201,162,39,0.12)', color: C.gold, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(201,162,39,0.3)' }}>
          {timeframe}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: C.border }}>
        <div style={{ background: C.panel2, padding: '12px 8px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 600, color: result.winRate >= 50 ? C.gain : C.loss }}>{result.winRate.toFixed(0)}%</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>نسبة النجاح</div>
        </div>
        <div style={{ background: C.panel2, padding: '12px 8px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 600, color: result.totalReturnPct >= 0 ? C.gain : C.loss }}>
            {result.totalReturnPct >= 0 ? '+' : ''}
            {result.totalReturnPct.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>العائد الكلي</div>
        </div>
        <div style={{ background: C.panel2, padding: '12px 8px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 600 }}>{result.totalTrades}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>صفقات</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 1, background: C.border, borderTop: `1px solid ${C.border}` }}>
        <div style={{ background: C.panel2, padding: '10px 8px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600 }}>{result.maxDrawdownPct.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>أكبر تراجع</div>
        </div>
        <div style={{ background: C.panel2, padding: '10px 8px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600 }}>{riskRatio}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>العائد ÷ المخاطرة</div>
        </div>
      </div>

      {result.trades.length > 0 && (
        <div style={{ padding: 14, borderTop: `1px solid ${C.border}` }}>
          <svg width="100%" height="36" viewBox={`0 0 ${width} 36`} preserveAspectRatio="none">
            <polyline points={svgPoints} fill="none" stroke={result.totalReturnPct >= 0 ? C.gain : C.loss} strokeWidth={2} />
          </svg>
        </div>
      )}

      {result.trades.length > 0 && (
        <div style={{ padding: '4px 14px 14px' }}>
          {result.trades.map((t, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                borderTop: `1px solid ${C.border}`,
              }}
            >
              <span style={{ color: C.textMuted }}>
                {new Date(t.entryDate).toLocaleDateString('ar')} ← {new Date(t.exitDate).toLocaleDateString('ar')}
                {t.autoClosedAtEnd && (
                  <span style={{ color: C.warn, marginRight: 6 }} title="أُغلقت افتراضياً - نهاية بيانات الفترة">
                    ⚠️ إغلاق افتراضي
                  </span>
                )}
              </span>
              <span style={{ color: t.returnPct >= 0 ? C.gain : C.loss, fontWeight: 600 }}>
                {t.returnPct >= 0 ? '+' : ''}
                {t.returnPct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {smallSample && (
        <div style={{ margin: '0 14px 14px', background: C.warnBg, border: '1px solid rgba(224,168,62,0.35)', color: C.warn, fontSize: 11.5, padding: '9px 11px', borderRadius: 8, lineHeight: 1.6 }}>
          ⚠️ {result.totalTrades} صفقة فقط — عينة صغيرة، النتيجة غير موثوقة إحصائياً. تحتاج 30+ صفقة للحكم الفعلي.
        </div>
      )}
    </div>
  );
}

// ============================================
// بطاقة سلسلة الخيارات
// ============================================
function OptionsChainCard({ output }: { output: OptionsChainOutput }) {
  if ('error' in output) {
    return (
      <div style={{ background: C.panel2, border: `1px solid ${C.loss}`, borderRadius: 14, padding: 14, fontSize: 12.5, color: C.loss }}>
        ⚠️ {output.error}
      </div>
    );
  }

  const { symbol, expiration, contracts, spotPrice, totalContractsAvailable } = output;

  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 14 }}>
          {symbol} — {expiration}
          {spotPrice !== null && (
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textMuted, fontWeight: 400 }}> · السعر ${spotPrice.toFixed(2)}</span>
          )}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, background: C.lossBg, color: C.loss, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(229,72,77,0.3)' }}>
          Sandbox متأخر 15د
        </span>
      </div>

      {totalContractsAvailable > contracts.length && (
        <div style={{ padding: '8px 14px 0', fontSize: 10.5, color: C.textMuted, fontFamily: FONT_AR }}>
          عرض أقرب {contracts.length} عقد للسعر الحالي من أصل {totalContractsAvailable} عقد متاح
        </div>
      )}

      <div style={{ padding: '4px 14px 14px' }}>
        {contracts.map((c, i) => {
          const liq = liquidityStyle(c.liquidity_quality);
          return (
            <div key={i} style={{ padding: '9px 0', borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT_MONO, fontSize: 11.5, marginBottom: 5 }}>
                <span>
                  {c.option_type === 'call' ? 'Call' : 'Put'} {c.strike} · Delta {c.greeks?.delta?.toFixed(2) ?? '—'}
                </span>
                <span style={{ background: liq.bg, color: liq.color, fontSize: 10, padding: '2px 7px', borderRadius: 5 }}>{c.liquidity_quality}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, fontFamily: FONT_MONO, fontSize: 10, color: C.textMuted }}>
                <span>Spread {c.spread_pct !== null ? c.spread_pct.toFixed(1) + '%' : '—'}</span>
                <span>OI {c.open_interest.toLocaleString()}</span>
                <span>حجم اليوم {c.volume.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// بطاقة تواريخ الاستحقاق
// ============================================
function ExpirationsCard({ output, onPick }: { output: any; onPick: (d: string) => void }) {
  if (output.error) {
    return (
      <div style={{ background: C.panel2, border: `1px solid ${C.loss}`, borderRadius: 14, padding: 14, fontSize: 12.5, color: C.loss }}>
        ⚠️ {output.error}
      </div>
    );
  }
  const dates: string[] = output.expirations || [];
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
      <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>تواريخ استحقاق {output.symbol}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {dates.slice(0, 8).map((d) => (
          <button
            key={d}
            onClick={() => onPick(d)}
            style={{ fontFamily: FONT_MONO, fontSize: 11, background: C.panel, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' }}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================
// الصفحة الرئيسية
// ============================================
export default function FahdPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState<TickerQuote[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    let active = true;
    async function loadTicker() {
      try {
        const res = await fetch('/api/market-ticker');
        const data = await res.json();
        if (active && data.quotes) setTicker(data.quotes);
      } catch {
        // فشل الشريط لا يوقف باقي الصفحة
      }
    }
    loadTicker();
    const interval = setInterval(loadTicker, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const res = await fetch('/api/fahd-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (data.reply) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, toolResults: data.toolResults || [] }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'صار خطأ، حاول مرة ثانية.' }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'تعذر الاتصال بالخادم.' }]);
    } finally {
      setLoading(false);
    }
  }

  function quickFill(prefix: string) {
    setInput(prefix);
    inputRef.current?.focus();
  }

  function renderToolResult(tr: ToolResult, key: number) {
    if (tr.name === 'run_backtest') return <BacktestCard key={key} output={tr.output as BacktestOutput} />;
    if (tr.name === 'get_options_chain') return <OptionsChainCard key={key} output={tr.output as OptionsChainOutput} />;
    if (tr.name === 'get_options_expirations') {
      return (
        <ExpirationsCard
          key={key}
          output={tr.output}
          onPick={(d) => sendMessage(`قيّم لي خيارات ${tr.output.symbol} بتاريخ استحقاق ${d}`)}
        />
      );
    }
    return null;
  }

  const tickerDouble = [...ticker, ...ticker];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: FONT_AR, direction: 'rtl' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        @keyframes fahd-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes fahd-spin { to { transform: rotate(360deg); } }
        .fahd-ticker-track { display: inline-flex; gap: 24px; padding: 0 16px; animation: fahd-ticker-scroll 22s linear infinite; }
        .fahd-spin { width: 12px; height: 12px; border: 2px solid ${C.border}; border-top-color: ${C.gold}; border-radius: 50%; animation: fahd-spin 0.8s linear infinite; }
        .fahd-qa-btn:hover { border-color: ${C.gold} !important; color: ${C.gold} !important; }
        .fahd-input::placeholder { color: ${C.textMuted}; }
      `}</style>

      {/* شريط الأسعار الحي */}
      {ticker.length > 0 && (
        <>
          <div style={{ position: 'sticky', top: 0, background: '#08090B', borderBottom: `1px solid ${C.border}`, padding: '8px 0', overflow: 'hidden', whiteSpace: 'nowrap', fontFamily: FONT_MONO, fontSize: 12, zIndex: 11 }}>
            <div className="fahd-ticker-track">
              {tickerDouble.map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: C.textMuted }}>{q.symbol}</span>
                  <span style={{ color: C.text, fontWeight: 500 }}>{q.price.toFixed(2)}</span>
                  <span style={{ color: q.changePct >= 0 ? C.gain : C.loss }}>
                    {q.changePct >= 0 ? '▲' : '▼'}
                    {Math.abs(q.changePct).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* رأس الصفحة */}
      <div style={{ position: 'sticky', top: ticker.length > 0 ? 33 : 0, background: '#111118', borderBottom: `1px solid ${C.border}`, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 10 }}>
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: `linear-gradient(135deg, ${C.gold}, ${C.goldDim})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#000', fontFamily: FONT_HEAD }}>
          ف
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.gold, fontFamily: FONT_HEAD }}>فهد</div>
          <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.gain, display: 'inline-block' }} />
            <span style={{ color: C.gain }}>السوق: حي</span>
            <span style={{ color: C.textMuted }}>·</span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.warn, display: 'inline-block' }} />
            <span style={{ color: C.warn }}>الخيارات: متأخرة 15د</span>
          </div>
        </div>
        <div style={{ marginRight: 'auto' }}>
          <a href="/" style={{ padding: '6px 14px', borderRadius: 10, background: '#16161f', border: `1px solid ${C.border}`, color: '#c8c8d4', fontSize: 13, textDecoration: 'none' }}>
            ← أحمد
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.length === 0 && (
          <>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px', fontSize: 14, lineHeight: 1.9, color: '#c8c8d4' }}>
              أنا فهد، محلل التداول 📈
              <br />
              <br />
              دوري أساعدك تطور نفسك كمتداول - أحلل معك الأسهم، أشغّل باك-تست على استراتيجيات، أقيّم عقود الخيارات، وأذكرك دائماً إن القرار والتنفيذ النهائي بيدك انت.
              <br />
              <br />
              وش تحب نسوي اليوم؟
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="fahd-qa-btn" onClick={() => quickFill('حلل لي سهم ')} style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, fontFamily: FONT_AR, fontSize: 12, padding: '8px 12px', borderRadius: 10, cursor: 'pointer' }}>
                📊 حلل سهم
              </button>
              <button className="fahd-qa-btn" onClick={() => quickFill('شغّل لي باك-تست على ')} style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, fontFamily: FONT_AR, fontSize: 12, padding: '8px 12px', borderRadius: 10, cursor: 'pointer' }}>
                🔁 باك-تست
              </button>
              <button className="fahd-qa-btn" onClick={() => quickFill('قيّم لي خيارات ')} style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, fontFamily: FONT_AR, fontSize: 12, padding: '8px 12px', borderRadius: 10, cursor: 'pointer' }}>
                🎯 قيّم خيارات
              </button>
            </div>
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: m.role === 'user' ? 'flex-start' : 'flex-end' }}>
            {m.role === 'assistant' && <div style={{ fontFamily: FONT_HEAD, fontSize: 11, color: C.gold, fontWeight: 700 }}>فهد</div>}
            <div
              style={{
                background: m.role === 'user' ? C.panel2 : 'linear-gradient(135deg, #2a3f1e, #1a2e0e)',
                border: `1px solid ${m.role === 'user' ? C.border : '#3d5a1e'}`,
                borderRadius: 16,
                padding: '11px 15px',
                maxWidth: '85%',
                fontSize: 14,
                lineHeight: 1.75,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
            {m.toolResults && m.toolResults.length > 0 && (
              <div style={{ width: '100%', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {m.toolResults.map((tr, j) => renderToolResult(tr, j))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, padding: '11px 15px', width: 'fit-content', fontFamily: FONT_MONO, fontSize: 12, color: C.textMuted }}>
            <div className="fahd-spin" />
            فهد يشتغل...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ position: 'fixed', bottom: 0, width: '100%', background: '#111118', borderTop: `1px solid ${C.border}`, padding: '14px 22px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10 }}>
          <input
            ref={inputRef}
            className="fahd-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="اسأل فهد عن سهم أو صفقة أو خيارات..."
            style={{ flex: 1, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '11px 15px', color: C.text, fontFamily: FONT_AR, fontSize: 14, outline: 'none' }}
          />
          <button onClick={() => sendMessage()} disabled={loading} style={{ width: 44, height: 44, background: C.gold, border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 18 }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
