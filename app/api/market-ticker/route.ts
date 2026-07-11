import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// ============================================
// GET /api/market-ticker?symbols=AAPL,TSLA
// يرجع أسعار حية من Finnhub لعرضها بشريط الأسعار أعلى واجهة فهد
// ============================================

export async function GET(req: NextRequest) {
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (!finnhubKey) {
    return NextResponse.json({ quotes: [] });
  }

  const { searchParams } = new URL(req.url);
  const extra = (searchParams.get('symbols') || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const symbols = [...new Set(['SPY', 'QQQ', ...extra])].slice(0, 8);

  const quotes = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${finnhubKey}`, {
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const d = await res.json();
        if (!d.c || d.c === 0) return null;
        return {
          symbol,
          price: d.c,
          changePct: d.dp ?? 0,
        };
      } catch {
        return null;
      }
    })
  );

  return NextResponse.json({ quotes: quotes.filter(Boolean) });
}
