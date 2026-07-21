import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { FAHD_SYSTEM_PROMPT } from '@/lib/fahd-system-prompt';
import { executeBacktest } from '@/lib/run-backtest';
import {
  getOptionsExpirations,
  getOptionsChain,
  getAccountBalance,
  getPositions,
  getTradierQuote,
} from '@/lib/tradier';
import { getTechnicalIndicators } from '@/lib/market-indicators';
import { getPreviousDayVolumeProfile } from '@/lib/massive';
import { getMarketDecision } from '@/lib/market-decision-engine';
import { scanSpxwOpportunitiesV3 } from '@/lib/trading/spxw-scanner-v3';
import { buildSpxwTriggerPlan } from '@/lib/trading/spxw-trigger-engine';
import { getStockDecision } from '@/lib/stock-decision-engine';
import {
  runTradeEngine,
  type TradeEngineInput,
} from '@/lib/trading/trade-engine';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function extractTickers(text: string): string[] {
  const matches = text.match(/\b[A-Z]{1,5}\b/g) || [];
  const ignore = ['API', 'ETF', 'CEO', 'AI', 'USA', 'US', 'RSI', 'EMA', 'SMA', 'VWAP', 'MACD', 'VIX', 'A', 'B', 'C', 'D'];
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
    return `${symbol}: ط§ظ„ط³ط¹ط± $${d.c} | ط§ظ„طھط؛ظٹط± ط§ظ„ظٹظˆظ…ظٹ ${d.dp?.toFixed(2)}% | ط£ط¹ظ„ظ‰ ط§ظ„ظٹظˆظ… $${d.h} | ط£ط¯ظ†ظ‰ ط§ظ„ظٹظˆظ… $${d.l} | ط§ظ„ط§ظپطھطھط§ط­ $${d.o} | ط¥ط؛ظ„ط§ظ‚ ط£ظ…ط³ $${d.pc}`;
  } catch (e: any) {
    console.error(`Finnhub quote fetch threw for ${symbol}: ${e?.message || e}`);
    return null;
  }
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

// ط¢ط®ط± 3 ط£ط®ط¨ط§ط± ظ…ظ‡ظ…ط© ظ„ظ„ط³ظ‡ظ… ط®ظ„ط§ظ„ 5 ط£ظٹط§ظ…
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
      return `  - [${date}] ${n.headline} (ط§ظ„ظ…طµط¯ط±: ${n.source})`;
    });
    return `ط£ط®ط¨ط§ط± ${symbol} ط§ظ„ط£ط®ظٹط±ط©:\n${lines.join('\n')}`;
  } catch (e: any) {
    console.error(`Finnhub company-news fetch threw for ${symbol}: ${e?.message || e}`);
    return null;
  }
}

// طھط­ظ‚ظ‚ ظ‡ظ„ ظپظٹظ‡ ط¥ط¹ظ„ط§ظ† ط£ط±ط¨ط§ط­ ط®ظ„ط§ظ„ ط§ظ„ظ€14 ظٹظˆظ… ط§ظ„ط¬ط§ظٹط© (ظ…ظ‡ظ… ط¬ط¯ط§ظ‹ ظ„ظ…طھط¯ط§ظˆظ„ظٹ ط§ظ„ط®ظٹط§ط±ط§طھ)
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
    return `âڑ ï¸ڈ ${symbol} ط¹ظ†ط¯ظ‡ط§ ط¥ط¹ظ„ط§ظ† ط£ط±ط¨ط§ط­ ظ…طھظˆظ‚ط¹ ط¨طھط§ط±ظٹط® ${next.date} (${next.hour === 'bmo' ? 'ظ‚ط¨ظ„ ط§ظ„ط§ظپطھطھط§ط­' : next.hour === 'amc' ? 'ط¨ط¹ط¯ ط§ظ„ط¥ط؛ظ„ط§ظ‚' : 'ظˆظ‚طھ ط؛ظٹط± ظ…ط­ط¯ط¯'}) - طھظˆظ‚ظ‘ط¹ طھظ‚ظ„ط¨ ط£ط¹ظ„ظ‰ ظ…ظ† ط§ظ„ظ…ط¹طھط§ط¯ ط­ظˆظ„ ظ‡ط°ط§ ط§ظ„طھط§ط±ظٹط®.`;
  } catch (e: any) {
    console.error(`Finnhub earnings calendar fetch threw for ${symbol}: ${e?.message || e}`);
    return null;
  }
}

// ظƒط§ط´ ط¨ط³ظٹط· ط¨ط§ظ„ط°ط§ظƒط±ط© (15 ط¯ظ‚ظٹظ‚ط©) ظ„ظ„ط£ط®ط¨ط§ط± ط§ظ„ظƒظ„ظٹط© ظˆط§ظ„طھظ‚ظˆظٹظ… ط§ظ„ط§ظ‚طھطµط§ط¯ظٹ
// ط¹ط´ط§ظ† ظ…ط§ ظ†ط³طھظ‡ظ„ظƒ ط­ط¯ Finnhub ط¨ظƒظ„ ط±ط³ط§ظ„ط© - ظ‡ط°ظٹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ط§ طھطھط؛ظٹط± ط¨ط§ظ„ط«ط§ظ†ظٹط© ط£طµظ„ط§ظ‹
const CACHE_TTL_MS = 15 * 60 * 1000;
let generalNewsCache: { data: string | null; expiresAt: number } | null = null;
let econCalendarCache: { data: string | null; expiresAt: number } | null = null;

// ط£ط®ط¨ط§ط± ط§ظ„ط³ظˆظ‚ ط§ظ„ط¹ط§ظ…ط© (ط§ظ‚طھطµط§ط¯ ظƒظ„ظٹطŒ ظ„ط§ طھط±طھط¨ط· ط¨ط³ظ‡ظ… ظ…ط¹ظٹظ†) - ط¢ط®ط± 4 ط¹ظ†ط§ظˆظٹظ†
async function getGeneralMarketNews(apiKey: string) {
  if (generalNewsCache && generalNewsCache.expiresAt > Date.now()) {
    return generalNewsCache.data;
  }
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
    const result = `ط£ط®ط¨ط§ط± ط§ظ„ط³ظˆظ‚ ط§ظ„ط¹ط§ظ…ط© (ط§ظ‚طھطµط§ط¯ ظƒظ„ظٹ):\n${lines.join('\n')}`;
    generalNewsCache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch (e: any) {
    console.error(`Finnhub general news fetch threw: ${e?.message || e}`);
    return null;
  }
}

// ط£ط­ط¯ط§ط« ط§ظ‚طھطµط§ط¯ظٹط© ظ…ظ‡ظ…ط© ظ‚ط§ط¯ظ…ط© ط®ظ„ط§ظ„ 7 ط£ظٹط§ظ… (ظپط§ط¦ط¯ط©طŒ طھط¶ط®ظ…طŒ ظˆط¸ط§ط¦ظپ...ط§ظ„ط®)
async function getEconomicCalendar(apiKey: string) {
  if (econCalendarCache && econCalendarCache.expiresAt > Date.now()) {
    return econCalendarCache.data;
  }
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
    // ظ†ط±ظƒط² ط¨ط³ ط¹ظ„ظ‰ ط§ظ„ط£ط­ط¯ط§ط« ط¹ط§ظ„ظٹط© ط§ظ„طھط£ط«ظٹط± (impact = 2 ط£ظˆ 3 ط¹ط§ط¯ط© ط¨ظ…ظ‚ظٹط§ط³ Finnhub)
    const important = items.filter((e: any) => (e.impact ?? 0) >= 2).slice(0, 5);
    if (important.length === 0) {
      econCalendarCache = { data: null, expiresAt: Date.now() + CACHE_TTL_MS };
      return null;
    }
    const lines = important.map((e: any) => `  - [${e.date}] ${e.event} (${e.country || ''})`);
    const result = `ط£ط­ط¯ط§ط« ط§ظ‚طھطµط§ط¯ظٹط© ظ…ظ‡ظ…ط© ظ‚ط§ط¯ظ…ط© (7 ط£ظٹط§ظ…):\n${lines.join('\n')}`;
    econCalendarCache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch (e: any) {
    console.error(`Finnhub economic calendar fetch threw: ${e?.message || e}`);
    return null;
  }
}

// ============================================
// ط£ط¯ط§ط© ط§ظ„ط¨ط§ظƒ-طھط³طھ: طھط¹ط±ظٹظپ ط§ظ„ط£ط¯ط§ط© ط§ظ„ظ„ظٹ ظپظ‡ط¯ ظٹظ‚ط¯ط± ظٹط³طھط¯ط¹ظٹظ‡ط§ ط¨ظ†ظپط³ظ‡
// ============================================
const TOOLS = [
  {
    name: 'get_spxw_trade_plan',
    description:
      'ط§ظ„ط£ط¯ط§ط© ط§ظ„ط±ط³ظ…ظٹط© ظ„ط§ط®طھظٹط§ط± ط¹ظ‚ط¯ SPXW ظˆط¨ظ†ط§ط، ط®ط·ط© ط§ظ„ط¯ط®ظˆظ„. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ ط³ط¤ط§ظ„ ظٹط²ظٹط¯ ط¹ظ† ط£ظپط¶ظ„ ط¹ظ‚ط¯ SPXW ط£ظˆ ظپط±طµط© SPX ط£ظˆ Call/Put ط¹ظ„ظ‰ SPX. ظ…ظ…ظ†ظˆط¹ طھط®ظ…ظٹظ† Strike ط£ظˆ Expiration ط£ظˆ ط­ط³ط§ط¨ SPX ظ…ظ† SPY.',
    input_schema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'ط¹ط¯ط¯ ط§ظ„ظ†طھط§ط¦ط¬ ط¨ط­ط¯ ط£ظ‚طµظ‰ ط¹ظ‚ط¯ظٹظ†.',
        },
      },
    },
  },
{
    name: 'get_technical_indicators',
    description:
      'ظٹط­ط³ط¨ ظ…ط¤ط´ط±ط§طھ ظپظ†ظٹط© ظ„ط³ظ‡ظ… ظ…ط¹ظٹظ†: RSI (طھط´ط¨ط¹ ط´ط±ط§ط¦ظٹ/ط¨ظٹط¹ظٹ)طŒ MACD (ط²ط®ظ… ظˆط§طھط¬ط§ظ‡)طŒ Bollinger Bands (طھط°ط¨ط°ط¨)طŒ ظˆط¯ط¹ظ…/ظ…ظ‚ط§ظˆظ…ط©. ط§ظ„ط¯ط¹ظ…/ط§ظ„ظ…ظ‚ط§ظˆظ…ط© ظٹط¬ظٹ ظ…ظ† Volume Profile ط­ظ‚ظٹظ‚ظٹ (VAH/VAL/POC ط¹ط¨ط± Massive.com) ظ„ظˆ ظ…طھظˆظپط±طŒ ظˆط¥ظ„ط§ ظٹط±ط¬ط¹ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ظ„ظ†ط·ط§ظ‚ طھط§ط±ظٹط®ظٹ طھظ‚ط±ظٹط¨ظٹ (ط£ط¹ظ„ظ‰/ط£ط¯ظ†ظ‰ ظ‚ظ…ط© ط¨ط¢ط®ط± 50 ط´ظ…ط¹ط©) - طھط­ظ‚ظ‚ ظ…ظ† supportResistance.source ظ„ظ…ط¹ط±ظپط© ط£ظٹظ‡ظ… ط±ط¬ط¹ ظپط¹ظ„ظٹط§ظ‹. ط§ط³طھط®ط¯ظ…ظ‡ط§ ظ„ظ…ط§ ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ† طھط­ظ„ظٹظ„ ظپظ†ظٹطŒ ط£ظˆ ظٹط³ط£ظ„ ط¹ظ† ظ…ط¤ط´ط± ظ…ط­ط¯ط¯ (RSIطŒ MACDطŒ ط¯ط¹ظ…طŒ ظ…ظ‚ط§ظˆظ…ط©) ظ„ط³ظ‡ظ….',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط§ظ„ط£ظ…ط±ظٹظƒظٹطŒ ظ…ط«ظ„ AAPL ط£ظˆ TSLA' },
        timeframe: {
          type: 'string',
          description: 'ط§ظ„ظپط±ظٹظ… ط§ظ„ط²ظ…ظ†ظٹ. ط§ظ„ط§ظپطھط±ط§ط¶ظٹ 1day (ظٹظˆظ…ظٹ).',
          enum: ['15min', '1h', '4h', '1day', '1week'],
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'run_backtest',
    description:
      'ظٹط´ط؛ظ‘ظ„ ط§ط®طھط¨ط§ط± طھط§ط±ظٹط®ظٹ (backtest) ظ„ط§ط³طھط±ط§طھظٹط¬ظٹط© EMA 9/21 + VWAP + طھط£ظƒظٹط¯ ط§ظ„ط­ط¬ظ… ط¹ظ„ظ‰ ط³ظ‡ظ… ظ…ط¹ظٹظ†طŒ ظˆظٹط±ط¬ط¹ ط¹ط¯ط¯ ط§ظ„طµظپظ‚ط§طھطŒ ظ†ط³ط¨ط© ط§ظ„ظ†ط¬ط§ط­طŒ ط§ظ„ط¹ط§ط¦ط¯ ط§ظ„ظƒظ„ظٹطŒ ظˆط£ظ‚طµظ‰ ط§ظ†ط®ظپط§ط¶. ط§ط³طھط®ط¯ظ…ظ‡ط§ ظ„ظ…ط§ ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ† ط£ط¯ط§ط، ط§ط³طھط±ط§طھظٹط¬ظٹط© ط£ظˆ ظ†طھظٹط¬ط© ط¨ط§ظƒ-طھط³طھ ظ„ط³ظ‡ظ… ظ…ط¹ظٹظ†.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط§ظ„ط£ظ…ط±ظٹظƒظٹطŒ ظ…ط«ظ„ AAPL ط£ظˆ TSLA' },
        timeframe: {
          type: 'string',
          description: 'ط§ظ„ظپط±ظٹظ… ط§ظ„ط²ظ…ظ†ظٹ. ط§ظ„ط§ظپطھط±ط§ط¶ظٹ 15min ظˆظ‡ظˆ ط§ظ„ط£ظ†ط³ط¨ ظ„ظ‡ط§ظ„ط§ط³طھط±ط§طھظٹط¬ظٹط©.',
          enum: ['5min', '15min', '30min', '1h', '4h', '1day'],
        },
        from: { type: 'string', description: 'طھط§ط±ظٹط® ط§ظ„ط¨ط¯ط§ظٹط© ط¨طµظٹط؛ط© YYYY-MM-DD (ط§ط®طھظٹط§ط±ظٹ)' },
        to: { type: 'string', description: 'طھط§ط±ظٹط® ط§ظ„ظ†ظ‡ط§ظٹط© ط¨طµظٹط؛ط© YYYY-MM-DD (ط§ط®طھظٹط§ط±ظٹ)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_market_decision',
    description:
      'ظٹط´ط؛ظ‘ظ„ ظ…ط­ط±ظƒ ظ‚ط±ط§ط± ط§ظ„ط³ظˆظ‚ ط¹ظ„ظ‰ SPY ظˆQQQ ظˆظٹط¹ظٹط¯ Market Score ظˆط§ط­طھظ…ط§ظ„ط§طھ Bullish/Bearish/Neutral ظˆط§ظ†ط­ظٹط§ط² CALL ط£ظˆ PUT ط£ظˆ WAIT. ط§ط³طھط®ط¯ظ…ظ‡ ظ‚ط¨ظ„ طھط­ظ„ظٹظ„ ط£ظٹ ط³ظ‡ظ… ط£ظˆ ط¹ظ‚ط¯ ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ظٹط²ظٹط¯ ط¹ظ† ط§طھط¬ط§ظ‡ ط§ظ„ط³ظˆظ‚ ط£ظˆ طھظˆظ‚ط¹ ط§ظ„طµط¹ظˆط¯ ظˆط§ظ„ظ‡ط¨ظˆط·.',
    input_schema: {
      type: 'object',
      properties: {
        timeframe: {
          type: 'string',
          enum: ['15min', '1h', '1day'],
          description: 'ظپط±ظٹظ… طھظ‚ظٹظٹظ… ط§ظ„ط³ظˆظ‚. ط§ظ„ط§ظپطھط±ط§ط¶ظٹ 15min ظ„ظ„ظ…ط¶ط§ط±ط¨ط© ط§ظ„ظٹظˆظ…ظٹط©.',
        },
      },
    },
  },
  {
    name: 'get_stock_decision',
    description:
      'ظٹط´ط؛ظ‘ظ„ ظ…ط­ط±ظƒ ط§طھط¬ط§ظ‡ ط³ظ‡ظ… ط§ط­طھط±ط§ظپظٹ ظˆظٹط±ط¬ط¹ Stock Score ظˆط§ط­طھظ…ط§ظ„ط§طھ ط§ظ„طµط¹ظˆط¯ ظˆط§ظ„ظ‡ط¨ظˆط· ظˆط§ظ„ط­ظٹط§ط¯ ظˆط¯ط±ط¬ط© ط§ظ„ط«ظ‚ط© ظˆط§ظ„ط§ظ†ط­ظٹط§ط² ظˆTrigger ظˆط¥ط¨ط·ط§ظ„ ط§ظ„ط³ظٹظ†ط§ط±ظٹظˆ ظˆط§ظ„ط£ظ‡ط¯ط§ظپ. ط§ط³طھط®ط¯ظ…ظ‡ ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ظٹط²ظٹط¯ ظ‡ظ„ ط³ظ‡ظ… ظ…ط¹ظٹظ† ط³ظٹطµط¹ط¯ ط£ظˆ ظٹظ‡ط¨ط· ط£ظˆ ظٹط·ظ„ط¨ طھط­ظ„ظٹظ„ طµظپظ‚ط© ط¹ظ„ظ‰ ط³ظ‡ظ….',
    input_schema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط§ظ„ط£ظ…ط±ظٹظƒظٹ ظ…ط«ظ„ AMZN ط£ظˆ NVDA ط£ظˆ AAPL',
        },
        timeframe: {
          type: 'string',
          enum: ['15min', '1h', '1day'],
          description: 'ظپط±ظٹظ… ط§ظ„طھط­ظ„ظٹظ„طŒ ط§ظ„ط§ظپطھط±ط§ط¶ظٹ 15min ظ„ظ„ظ…ط¶ط§ط±ط¨ط© ط§ظ„ظٹظˆظ…ظٹط©.',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_account',
    description:
      'ظٹط¬ظ„ط¨ ط¨ظٹط§ظ†ط§طھ ط­ط³ط§ط¨ ظٹط²ظٹط¯ ط§ظ„ط­ظ‚ظٹظ‚ظٹ ظپظٹ Tradier: ط¥ط¬ظ…ط§ظ„ظٹ ظ‚ظٹظ…ط© ط§ظ„ط­ط³ط§ط¨طŒ ط§ظ„ظ†ظ‚ط¯طŒ ط§ظ„ظ‚ظˆط© ط§ظ„ط´ط±ط§ط¦ظٹط© ظ„ظ„ط£ط³ظ‡ظ… ظˆط§ظ„ط®ظٹط§ط±ط§طھطŒ ظˆط§ظ„ط£ط±ط¨ط§ط­ ظˆط§ظ„ط®ط³ط§ط¦ط± ط§ظ„ظ…ظپطھظˆط­ط©. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ظٹط²ظٹط¯ ط¹ظ† ط±طµظٹط¯ظ‡طŒ ط§ظ„ط³ظٹظˆظ„ط©طŒ ط§ظ„ظ‚ظˆط© ط§ظ„ط´ط±ط§ط¦ظٹط©طŒ ط£ظˆ ط­ط§ظ„ط© ط§ظ„ط­ط³ط§ط¨.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_positions',
    description:
      'ظٹط¬ظ„ط¨ ط§ظ„ظ…ط±ط§ظƒط² ط§ظ„ظ…ظپطھظˆط­ط© ط§ظ„ط­ط§ظ„ظٹط© ظپظٹ ط­ط³ط§ط¨ ظٹط²ظٹط¯ ط¹ظ„ظ‰ TradierطŒ ط¨ظ…ط§ ظپظٹظ‡ط§ ط§ظ„ط±ظ…ط² ظˆط§ظ„ظƒظ…ظٹط© ظˆط§ظ„طھظƒظ„ظپط©. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ط¹ظ† ط§ظ„طµظپظ‚ط§طھ ط£ظˆ ط§ظ„ظ…ط±ط§ظƒط² ط§ظ„ظ…ظپطھظˆط­ط© ط£ظˆ ظ…ط§ ظٹظ…ظ„ظƒظ‡ ط­ط§ظ„ظٹط§ظ‹.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_tradier_quote',
    description:
      'ظٹط¬ظ„ط¨ ط§ظ„ط³ط¹ط± ط§ظ„ط­ط§ظ„ظٹ ظˆBid ظˆAsk ظˆط§ظ„ط­ط¬ظ… ظˆط§ظ„طھط؛ظٹط± ط§ظ„ظٹظˆظ…ظٹ ظ…ط¨ط§ط´ط±ط© ظ…ظ† Tradier ظ„ط³ظ‡ظ… ط£ظˆ ETF ط£ظ…ط±ظٹظƒظٹ. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ظ…ط§ ظٹط·ظ„ط¨ ظٹط²ظٹط¯ ط³ط¹ط± Tradier ط£ظˆ ظٹط±ظٹط¯ ظ…ظ‚ط§ط±ظ†ط© ط¨ظٹط§ظ†ط§طھ Finnhub ظ…ط¹ Tradier.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط£ظˆ ETFطŒ ظ…ط«ظ„ AAPL ط£ظˆ SPY',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_options_expirations',
    description:
      'ظٹط¬ظٹط¨ طھظˆط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚ ط¹ظ‚ظˆط¯ ط§ظ„ط®ظٹط§ط±ط§طھ ط§ظ„ظ…طھط§ط­ط© ظ„ط³ظ‡ظ… ظ…ط¹ظٹظ†. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط£ظˆظ„ ظ„ظ…ط§ ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ† ط®ظٹط§ط±ط§طھ ط³ظ‡ظ… ظˆظ„ط§ ظٹط­ط¯ط¯ طھط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚طŒ ط¹ط´ط§ظ† طھط¹ط±ظپ ظˆط´ ط§ظ„طھظˆط§ط±ظٹط® ط§ظ„ظ…طھط§ط­ط© ظ‚ط¨ظ„ ظ…ط§ طھط¬ظٹط¨ ط§ظ„ط³ظ„ط³ظ„ط©.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط§ظ„ط£ظ…ط±ظٹظƒظٹطŒ ظ…ط«ظ„ AAPL ط£ظˆ TSLA' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_options_chain',
    description:
      'ظٹط¬ظٹط¨ ط³ظ„ط³ظ„ط© ط®ظٹط§ط±ط§طھ ظƒط§ظ…ظ„ط© (Calls ظˆPuts) ظ„ط³ظ‡ظ… ظˆطھط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚ ظ…ط¹ظٹظ†طŒ ظ…ط¹ ط§ظ„ط£ط³ط¹ط§ط± ظˆGreeks (Delta, Theta, Gamma, Vega, IV) ظˆطھظ‚ظٹظٹظ… ط¬ظˆط¯ط© ط§ظ„ط³ظٹظˆظ„ط© ظ„ظƒظ„ ط¹ظ‚ط¯ (ط³ط¨ط±ظٹط¯طŒ Open InterestطŒ ط§ظ„ط­ط¬ظ…). âڑ ï¸ڈ ط¨ظٹط§ظ†ط§طھ Sandbox ظ…طھط£ط®ط±ط© 15 ط¯ظ‚ظٹظ‚ط© - ظ„ظ„طھظ‚ظٹظٹظ… ظˆط§ظ„طھط¬ط±ط¨ط© ظپظ‚ط·طŒ ظ…ظˆ ظ„ظ‚ط±ط§ط± ط¯ط®ظˆظ„ ظ„ط­ط¸ظٹ. ظ„ط§ط²ظ… طھط³طھط®ط¯ظ… get_options_expirations ط£ظˆظ„ ظ„ظˆ ظ…ط§ ط¹ظ†ط¯ظƒ طھط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚ ظ…ط­ط¯ط¯.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط§ظ„ط£ظ…ط±ظٹظƒظٹ' },
        expiration: { type: 'string', description: 'طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ ط¨طµظٹط؛ط© YYYY-MM-DD' },
      },
      required: ['symbol', 'expiration'],
    },
  },
  {
    name: 'get_volume_profile',
    description:
      'ظٹط­ط³ط¨ Volume Profile ط§ظ„ظپط¹ظ„ظٹ ظ„ظ„ظٹظˆظ… ط§ظ„ط³ط§ط¨ظ‚ (VAHطŒ VALطŒ POC) ظ…ظ† ط¨ظٹط§ظ†ط§طھ طھط¯ط§ظˆظ„ ط­ظ‚ظٹظ‚ظٹط© ط¹ط¨ط± Massive.com. âڑ ï¸ڈ ظ„ظˆ ط³ط¨ظ‚ ظˆط§ط³طھط¯ط¹ظٹطھ get_technical_indicators ظ„ظ†ظپط³ ط§ظ„ط³ظ‡ظ… ظˆط±ط¬ط¹ supportResistance.source = "volume_profile"طŒ ظپظ‡ط°ظٹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ظˆط¬ظˆط¯ط© ط¹ظ†ط¯ظƒ ظ…ط³ط¨ظ‚ط§ظ‹ - ظ„ط§ طھط³طھط¯ط¹ظگ ظ‡ط°ظٹ ط§ظ„ط£ط¯ط§ط© ظ…ط±ط© ط«ط§ظ†ظٹط© ط¥ظ„ط§ ظ„ظˆ ظٹط²ظٹط¯ ط³ط£ظ„ ط¹ظ† Volume Profile طµط±ط§ط­ط© ط£ظˆ ظƒط§ظ† ط§ظ„ظ…طµط¯ط± ط§ظ„ط³ط§ط¨ظ‚ "historical_range". ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¥ظ„ط²ط§ظ…ظٹط§ظ‹ ظپظٹ ظ…ط±ط­ظ„ط© Zone ظ…ظ† ظ…ط­ط±ظƒ CZT ط¹ظ†ط¯ طھط­ط¯ظٹط¯ ظ…ظ†ط§ط·ظ‚ Previous Day VAH/VAL/POC ظ„ظˆ ظ…ط§ ط¹ظ†ط¯ظƒ ط¨ظٹط§ظ†ط§طھ ظ…ط³ط¨ظ‚ط©.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط§ظ„ط£ظ…ط±ظٹظƒظٹطŒ ظ…ط«ظ„ AAPL ط£ظˆ TSLA' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_recent_tv_signals',
    description:
      'ظٹط¬ظٹط¨ ط¢ط®ط± ط¥ط´ط§ط±ط§طھ ظˆط±ط¯طھ ظ…ظ† ظ…ط¤ط´ط± PRO Multi-Tool ط¹ظ„ظ‰ TradingView (ط¥ط´ط§ط±ط© BOOM ظ‡ط§ط¨ط·/طµط§ط¹ط¯طŒ ط£ظˆ ظ†ظ…ط· طھظˆط§ظپظ‚ظٹ Harmonic) ظ„ط³ظ‡ظ… ظ…ط¹ظٹظ† ط£ظˆ ظ„ظƒظ„ ط§ظ„ط£ط³ظ‡ظ…. ط§ط³طھط®ط¯ظ…ظ‡ط§ ظ„ظ…ط§ ظٹط²ظٹط¯ ظٹط³ط£ظ„ "ظ‡ظ„ طµط§ط± BOOM ط¹ظ„ظ‰ ط³ظ‡ظ… ظ…ط¹ظٹظ†طں" ط£ظˆ ظٹط³ط£ظ„ ط¹ظ† ط¢ط®ط± ط¥ط´ط§ط±ط§طھ ط§ظ„ظ…ط¤ط´ط±طŒ ط£ظˆ ظƒط¬ط²ط، ظ…ظ† طھط£ظƒظٹط¯ Trigger ط¨ظ…ط­ط±ظƒ CZT ط¥ط°ط§ ظƒط§ظ† ظٹط²ظٹط¯ ظٹط±ط§ظ‚ط¨ ظ‡ط°ط§ ط§ظ„ط³ظ‡ظ… ط¨ط§ظ„ظ…ط¤ط´ط±.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'ط±ظ…ط² ط§ظ„ط³ظ‡ظ… (ط§ط®طھظٹط§ط±ظٹ) - ظ„ظˆ ظ…ط§ طھط­ط¯ط¯طŒ طھط±ط¬ط¹ ط¢ط®ط± ط§ظ„ط¥ط´ط§ط±ط§طھ ظ…ظ† ظƒظ„ ط§ظ„ط£ط³ظ‡ظ…' },
        limit: {
          type: 'number',
          description: 'ط¹ط¯ط¯ ط§ظ„ط¥ط´ط§ط±ط§طھ ط§ظ„ظ…ط·ظ„ظˆط¨ط©طŒ ظ…ظ† 1 ط¥ظ„ظ‰ 50طŒ ط§ظپطھط±ط§ط¶ظٹط§ظ‹ 10',
          minimum: 1,
          maximum: 50,
          default: 10,
        },
      },
    },
  },

  {
    name: 'analyze_trade',
    description:
      'ظٹط´ط؛ظ‘ظ„ ظ…ط­ط±ظƒ طھظ‚ظٹظٹظ… ط§ظ„طµظپظ‚ط© ط§ظ„ظƒط§ظ…ظ„ ظˆظپظ‚ Condition ط«ظ… Zone ط«ظ… Trigger ط«ظ… طھظ‚ظٹظٹظ… ط§ظ„ط¹ظ‚ط¯. ط§ط³طھط®ط¯ظ…ظ‡ ط¹ظ†ط¯ظ…ط§ ظٹط±ط³ظ„ ظٹط²ظٹط¯ ط¨ظٹط§ظ†ط§طھ طµظپظ‚ط© ط®ظٹط§ط±ط§طھ ظƒط§ظ…ظ„ط© ط£ظˆ ظٹط·ظ„ط¨ طھظ‚ظٹظٹظ…ط§ظ‹ ظ†ظ‡ط§ط¦ظٹط§ظ‹ ظ„ط¹ظ‚ط¯ CALL ط£ظˆ PUT. ظ„ط§ طھط®طھط±ط¹ ط£ط±ظ‚ط§ظ…ط§ظ‹ ظ†ط§ظ‚طµط©. ط¥ط°ط§ ظƒط§ظ†طھ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط£ط³ط§ط³ظٹط© ط؛ظٹط± ظ…طھظˆظپط±ط©طŒ ظˆط¶ظ‘ط­ ظ…ط§ ظٹظ†ظ‚طµ ط£ظˆ ط§ط³طھط®ط¯ظ… ط§ظ„ط£ط¯ظˆط§طھ ط§ظ„ظ…طھط§ط­ط© ظ„ط¬ظ…ط¹ظ‡ ط£ظˆظ„ط§ظ‹.',
    input_schema: {
      type: 'object',
      properties: {
        market: {
          type: 'object',
          description: 'ط¨ظٹط§ظ†ط§طھ ط­ط§ظ„ط© ط§ظ„ط³ظˆظ‚ ط§ظ„ط¹ط§ظ…ط©',
          properties: {
            spy: {
              type: 'object',
              properties: {
                price: { type: 'number' },
                vwap: { type: 'number' },
                ema20: { type: 'number' },
                ema50: { type: 'number' },
                rsi: { type: 'number' },
                changePercent: { type: 'number' },
              },
              required: ['price'],
            },
            qqq: {
              type: 'object',
              properties: {
                price: { type: 'number' },
                vwap: { type: 'number' },
                ema20: { type: 'number' },
                ema50: { type: 'number' },
                rsi: { type: 'number' },
                changePercent: { type: 'number' },
              },
              required: ['price'],
            },
            vix: {
              type: 'object',
              properties: {
                price: { type: 'number' },
                changePercent: { type: 'number' },
              },
            },
            breadth: {
              type: 'object',
              properties: {
                advanceDeclineRatio: { type: 'number' },
                percentAboveVwap: { type: 'number' },
              },
            },
            sector: {
              type: 'object',
              properties: {
                changePercent: { type: 'number' },
                relativeStrength: { type: 'number' },
              },
            },
          },
          required: ['spy', 'qqq'],
        },
        stock: {
          type: 'object',
          description: 'ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظ‡ظ… ط£ظˆ ط§ظ„ط£طµظ„ ط§ظ„ط£ط³ط§ط³ظٹ',
          properties: {
            symbol: { type: 'string' },
            price: { type: 'number' },
            vwap: { type: 'number' },
            ema20: { type: 'number' },
            ema50: { type: 'number' },
            ema200: { type: 'number' },
            rsi: { type: 'number' },
            macdHistogram: { type: 'number' },
            adx: { type: 'number' },
            relativeVolume: { type: 'number' },
            volume: { type: 'number' },
            averageVolume: { type: 'number' },
            poc: { type: 'number' },
            vah: { type: 'number' },
            val: { type: 'number' },
            support: { type: 'number' },
            resistance: { type: 'number' },
            relativeStrength: { type: 'number' },
            catalyst: {
              type: 'object',
              properties: {
                hasNews: { type: 'boolean' },
                earningsSoon: { type: 'boolean' },
                sentiment: {
                  type: 'string',
                  enum: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'],
                },
              },
            },
          },
          required: ['symbol', 'price'],
        },
        option: {
          type: 'object',
          description: 'ط¨ظٹط§ظ†ط§طھ ط¹ظ‚ط¯ ط§ظ„ط®ظٹط§ط±ط§طھ',
          properties: {
            symbol: { type: 'string' },
            strike: { type: 'number' },
            optionType: {
              type: 'string',
              enum: ['CALL', 'PUT'],
            },
            expiration: { type: 'string' },
            bid: { type: 'number' },
            ask: { type: 'number' },
            last: { type: 'number' },
            delta: { type: 'number' },
            gamma: { type: 'number' },
            theta: { type: 'number' },
            impliedVolatility: { type: 'number' },
            volume: { type: 'number' },
            openInterest: { type: 'number' },
            underlyingPrice: { type: 'number' },
            daysToExpiration: { type: 'number' },
          },
          required: [
            'symbol',
            'strike',
            'optionType',
            'expiration',
            'underlyingPrice',
            'daysToExpiration',
          ],
        },
        trigger: {
          type: 'object',
          description: 'ط¨ظٹط§ظ†ط§طھ طھط£ظƒظٹط¯ ط§ظ„ط¯ط®ظˆظ„',
          properties: {
            direction: {
              type: 'string',
              enum: ['CALL', 'PUT', 'NEUTRAL'],
            },
            candleClose: { type: 'number' },
            previousCandleClose: { type: 'number' },
            breakoutLevel: { type: 'number' },
            breakdownLevel: { type: 'number' },
            priceAboveVwap: { type: 'boolean' },
            priceBelowVwap: { type: 'boolean' },
            relativeVolume: { type: 'number' },
          },
          required: ['direction', 'candleClose'],
        },
      },
      required: ['market', 'stock', 'option', 'trigger'],
    },
  },
];


function enrichTradierQuoteFreshness(quote: any) {
  const rawTradeDate = Number(quote?.trade_date);

  // Tradier ظ‚ط¯ ظٹط±ط¬ط¹ trade_date ط¨ط§ظ„ظ…ظ„ظ„ظٹ ط«ط§ظ†ظٹط© ط£ظˆ ط¨ط§ظ„ط«ظˆط§ظ†ظٹ ط­ط³ط¨ ظ†ظˆط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ.
  const tradeTimestampMs = Number.isFinite(rawTradeDate) && rawTradeDate > 0
    ? rawTradeDate > 10_000_000_000
      ? rawTradeDate
      : rawTradeDate * 1000
    : null;

  const ageSeconds = tradeTimestampMs
    ? Math.max(0, Math.round((Date.now() - tradeTimestampMs) / 1000))
    : null;

  let freshness: 'live' | 'delayed' | 'stale' | 'unknown' = 'unknown';

  if (ageSeconds !== null) {
    if (ageSeconds <= 60) freshness = 'live';
    else if (ageSeconds <= 20 * 60) freshness = 'delayed';
    else freshness = 'stale';
  }

  // ظ†ط­ط°ظپ average_volume ظ…ظ† ط§ظ„ظ†طھظٹط¬ط© ط§ظ„ظ…ط±ط³ظ„ط© ظ„ظ„ظ†ظ…ظˆط°ط¬ ط­طھظ‰ ظ„ط§ ظٹظ‚ط§ط±ظ†
  // ط­ط¬ظ…ظ‹ط§ ط¬ط²ط¦ظٹظ‹ط§ ط£ط«ظ†ط§ط، ط§ظ„ط¬ظ„ط³ط© ط¨ظ…طھظˆط³ط· ظٹظˆظ… ظƒط§ظ…ظ„ ظˆظٹط®ط±ط¬ ط¨ظ†ط³ط¨ط© ظ…ط¶ظ„ظ„ط©.
  const {
    average_volume: _removedAverageVolume,
    ...safeQuote
  } = quote || {};

  const displayTitle =
    freshness === 'live'
      ? `ط³ط¹ط± ${safeQuote.symbol || ''} â€” Tradier (ط­ط¯ظٹط« ط¬ط¯ط§ظ‹)`
      : freshness === 'delayed'
        ? `ط³ط¹ط± ${safeQuote.symbol || ''} â€” Tradier (ظ‚ط¯ ظٹظƒظˆظ† ظ…طھط£ط®ط±ط§ظ‹)`
        : freshness === 'stale'
          ? `ط³ط¹ط± ${safeQuote.symbol || ''} â€” Tradier (ظ‚ط¯ظٹظ…)`
          : `ط³ط¹ط± ${safeQuote.symbol || ''} â€” Tradier (ط­ط¯ط§ط«ط© ط؛ظٹط± ظ…ط¤ظƒط¯ط©)`;

  return {
    ...safeQuote,
    display_title: displayTitle,
    updated_at: tradeTimestampMs
      ? new Date(tradeTimestampMs).toISOString()
      : null,
    age_seconds: ageSeconds,
    freshness,
    freshness_label:
      freshness === 'live'
        ? 'ط­ط¯ظٹط«ط© ط¬ط¯ط§ظ‹'
        : freshness === 'delayed'
          ? 'ظ‚ط¯ طھظƒظˆظ† ظ…طھط£ط®ط±ط©'
          : freshness === 'stale'
            ? 'ظ‚ط¯ظٹظ…ط©'
            : 'ط؛ظٹط± ظ…ط¤ظƒط¯ط©',
    volume_assessment: {
      allowed: false,
      reason:
        'ظ„ط§ طھظˆط¬ط¯ ظ…ظ‚ط§ط±ظ†ط© Time-of-Day RVOLطŒ ظ„ط°ظ„ظƒ ظ„ط§ ظٹط¬ظˆط² ظˆطµظپ ط§ظ„ط­ط¬ظ… ط¨ط£ظ†ظ‡ ظ…ظ†ط®ظپط¶ ط£ظˆ ظ…ط±طھظپط¹.',
      instruction:
        'ط§ط¹ط±ط¶ ط­ط¬ظ… ط§ظ„ظٹظˆظ… ط­طھظ‰ ط§ظ„ط¢ظ† ظپظ‚ط· ط¨ط¯ظˆظ† ظ†ط³ط¨ط© ظˆط¨ط¯ظˆظ† ط­ظƒظ… ط¹ظ„ظ‰ ط§ظ„ظ‚ظˆط©.',
    },
  };
}

// ط­ظپط¸ طھظ„ظ‚ط§ط¦ظٹ: ظٹط³ط£ظ„ Claude ط¥ط°ط§ ظƒط§ظ†طھ ط±ط³ط§ظ„ط© ظٹط²ظٹط¯ طھط­طھظˆظٹ ظ…ط¹ظ„ظˆظ…ط© طھط³طھط­ظ‚ ط§ظ„ط­ظپط¸ ط§ظ„ط¯ط§ط¦ظ…
// ظپظ„طھط± ط³ط±ظٹط¹ ط¨ط¯ظˆظ† AI: ظ‡ظ„ ط§ظ„ط±ط³ط§ظ„ط© ظٹظڈط­طھظ…ظ„ طھط­طھظˆظٹ ظ…ط¹ظ„ظˆظ…ط© طھط³طھط­ظ‚ ط§ظ„ط­ظپط¸طں
// ظٹط´طھط؛ظ„ ظ‚ط¨ظ„ ط£ظٹ ط§ط³طھط¯ط¹ط§ط، ظ„ظ€ ClaudeطŒ ط¹ط´ط§ظ† ظ†ظˆظپط± ط§ظ„ظˆظ‚طھ ظˆط§ظ„طھظƒظ„ظپط© ظ„ظ…ط¹ط¸ظ… ط§ظ„ط±ط³ط§ط¦ظ„ ط§ظ„ط¹ط§ط¯ظٹط©
function mightContainSaveworthyInfo(userMessage: string): boolean {
  // ظ„ط§ ظ†ط­ظپط¸ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط³ط§ط¨ ط§ظ„ط­ط³ط§ط³ط© ط£ظˆ ط§ظ„ظ…ط¤ظ‚طھط© ظپظٹ ط§ظ„ط°ط§ظƒط±ط© ط·ظˆظٹظ„ط© ط§ظ„ظ…ط¯ظ‰
  if (/ط±طµظٹط¯|ظ‚ظˆط©\s*ط´ط±ط§ط¦ظٹط©|ظ…ط±ط§ظƒط²ظٹ|ظ…ط±ط§ظƒط²\s*ظ…ظپطھظˆط­ط©|ط­ط³ط§ط¨\s*Tradier|طھط±ط§ط¯ظٹط±/i.test(userMessage)) {
    return false;
  }

  const signals = [
    /\d/, // ط£ظٹ ط±ظ‚ظ… (ط³ط¹ط±طŒ ظ†ط³ط¨ط©طŒ ظƒظ…ظٹط©)
    /ط¯ط®ظ„طھ|ط®ط±ط¬طھ|طµظپظ‚ط©|ظ‚ط§ط¹ط¯ط©|طھط¹ظ„ظ…طھ|ط¯ط±ط³|ط£ظپط¶ظ„\s*ظ…ط§|ظ…ط§\s*ط£ط¯ط®ظ„|ظ…ط§\s*ط£ط¯ط®ظ„\s*ظ‚ط¨ظ„|ظˆظ‚ظپ\s*ط®ط³ط§ط±ط©|ظ‡ط¯ظپ\s*ط±ط¨ط­/,
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
        system: `ط£ظ†طھ ظ†ط¸ط§ظ… ظپط±ط² ظ„ظ„ط°ط§ظƒط±ط© ط·ظˆظٹظ„ط© ط§ظ„ظ…ط¯ظ‰ ظ„ظ…ط³ط§ط¹ط¯ طھط¯ط§ظˆظ„. ظ…ظ‡ظ…طھظƒ: طھط­ط¯ظٹط¯ ط¥ط°ط§ ظƒط§ظ†طھ ط±ط³ط§ظ„ط© ط§ظ„ظ…ط³طھط®ط¯ظ… طھط­طھظˆظٹ ظ…ط¹ظ„ظˆظ…ط© طھط³طھط­ظ‚ ط§ظ„ط­ظپط¸ ط§ظ„ط¯ط§ط¦ظ….

ظٹط³طھط­ظ‚ ط§ظ„ط­ظپط¸ ظپظ‚ط·:
- طµظپظ‚ط© ظپط¹ظ„ظٹط© (ط¯ط®ظˆظ„/ط®ط±ظˆط¬ ط¨ط³ط¹ط± ظ…ط­ط¯ط¯)
- ظ‚ط§ط¹ط¯ط© طھط¯ط§ظˆظ„ ط´ط®طµظٹط© ("ظ…ط§ ط£ط¯ط®ظ„ ظ‚ط¨ظ„ FOMC")
- ط¯ط±ط³ ظ…ط³طھظپط§ط¯ ظ…ظ† ط®ط·ط£ ط£ظˆ ظ†ط¬ط§ط­
- طھظپط¶ظٹظ„ ط¯ط§ط¦ظ… (ط£ط³ظ‡ظ… ظ…ط¹ظٹظ†ط©طŒ ط£ط³ظ„ظˆط¨ ظ…ط¹ظٹظ†طŒ ط­ط¬ظ… ظ…ط®ط§ط·ط±ط©)
- ظ…ط¹ظ„ظˆظ…ط© ط´ط®طµظٹط© ظ…ظ‡ظ…ط© طھط¤ط«ط± ط¹ظ„ظ‰ ط§ظ„طھط¯ط§ظˆظ„

ظ„ط§ ظٹط³طھط­ظ‚ ط§ظ„ط­ظپط¸: ط£ط³ط¦ظ„ط© ط¹ط§ظ…ط©طŒ ط·ظ„ط¨ط§طھ طھط­ظ„ظٹظ„طŒ ط¯ط±ط¯ط´ط©طŒ ظ…ط¹ظ„ظˆظ…ط§طھ ظ…ط¤ظ‚طھط©.

ط¥ط°ط§ ظˆط¬ط¯طھ ظ…ط¹ظ„ظˆظ…ط© طھط³طھط­ظ‚ ط§ظ„ط­ظپط¸طŒ ط±ط¯ ط¨طµظٹط؛ط© JSON ظپظ‚ط·:
{"save": true, "key": "ط¹ظ†ظˆط§ظ†_ظ…ط®طھطµط±_ط¨ط§ظ„ط¹ط±ط¨ظٹ", "value": "ط§ظ„ظ…ط¹ظ„ظˆظ…ط© ظƒط§ظ…ظ„ط© ط¨ط¬ظ…ظ„ط© ظˆط§ط¶ط­ط©"}

ط¥ط°ط§ ظ„ط§ ظٹظˆط¬ط¯ ط´ظٹط، ظٹط³طھط­ظ‚:
{"save": false}

ط±ط¯ ط¨ظ€ JSON ظپظ‚ط· ط¨ط¯ظˆظ† ط£ظٹ ظ†طµ ط¥ط¶ط§ظپظٹ.`,
        messages: [
          { role: 'user', content: `ط±ط³ط§ظ„ط© ظٹط²ظٹط¯: "${userMessage}"` },
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
    // ظپط´ظ„ ط§ظ„ط­ظپط¸ ط§ظ„طھظ„ظ‚ط§ط¦ظٹ ظ„ط§ ظٹظˆظ‚ظپ ط§ظ„ظ…ط­ط§ط¯ط«ط©
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
    throw new Error('ظپط´ظ„ ط§ظ„ط§طھطµط§ظ„ ط¨ط§ظ„ظ†ظ…ظˆط°ط¬');
  }
  return response.json();
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'ط§ظ„ط±ط³ط§ظ„ط© ظ…ط·ظ„ظˆط¨ط©' }, { status: 400 });
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
      // ظ†ط´ظ…ظ„ ط¢ط®ط± ط±ط³ط§ط¦ظ„ ظٹط²ظٹط¯ ط¨ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ط±ظ…ط²طŒ ظ…ظˆ ط¨ط³ ط§ظ„ط±ط³ط§ظ„ط© ط§ظ„ط­ط§ظ„ظٹط©طŒ
      // ط¹ط´ط§ظ† ظ„ظˆ ط³ط£ظ„ ط¨ط§ظ„ط³ظٹط§ظ‚ ("ظˆط´ ط³ط¹ط±ظ‡طں") ط¨ط¹ط¯ ظ…ط§ ط°ظƒط± ط§ظ„ط±ظ…ط² ط¨ط±ط³ط§ظ„ط© ط³ط§ط¨ظ‚ط©
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
        marketData = `\n\n# ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظˆظ‚ ط§ظ„ط­ظٹط© (ظ…ظ† Finnhub - ظ…ط­ط¯ط«ط© ط§ظ„ط¢ظ†):\n(ظ…ظ„ط§ط­ط¸ط©: SPY ظٹظ…ط«ظ„ S&P 500 ظˆ QQQ ظٹظ…ط«ظ„ NASDAQ 100)\n${quoteLines.join('\n')}`;
      } else {
        console.error(`No quotes returned at all for symbols: ${quoteSymbols.join(',')}`);
      }

      // ط£ط®ط¨ط§ط± ظˆطھظ‚ظˆظٹظ… ط£ط±ط¨ط§ط­ - ط¨ط³ ظ„ظ„ط£ط³ظ‡ظ… ط§ظ„ظ…ط­ط¯ط¯ط© (ظ…ظˆ SPY/QQQ) ط¹ط´ط§ظ† ظ†طھط¬ظ†ط¨ ط·ظ„ط¨ط§طھ ط²ط§ظٹط¯ط©
      if (tickers.length > 0) {
        const newsResults = await Promise.all(tickers.map((s) => getCompanyNews(s, finnhubKey)));
        const earningsResults = await Promise.all(tickers.map((s) => getUpcomingEarnings(s, finnhubKey)));
        const newsLines = newsResults.filter(Boolean);
        const earningsLines = earningsResults.filter(Boolean);
        if (newsLines.length > 0) {
          marketData += `\n\n# ط£ط®ط¨ط§ط± ط­ط¯ظٹط«ط© (ظ…ظ† Finnhub):\n${newsLines.join('\n')}`;
        }
        if (earningsLines.length > 0) {
          marketData += `\n\n# طھظ†ط¨ظٹظ‡ط§طھ ط£ط±ط¨ط§ط­ ظ‚ط±ظٹط¨ط©:\n${earningsLines.join('\n')}`;
        }
      }

      // ط£ط®ط¨ط§ط± ظƒظ„ظٹط© ظˆطھظ‚ظˆظٹظ… ط§ظ‚طھطµط§ط¯ظٹ - ط¯ط§ط¦ظ…ط§ظ‹طŒ ط¨ط؛ط¶ ط§ظ„ظ†ط¸ط± ط¹ظ† ط§ظ„ط³ظ‡ظ… ط§ظ„ظ…ط°ظƒظˆط±
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
    fullSystemPrompt += `

# ظ‚ط§ط¹ط¯ط© ط¥ظ„ط²ط§ظ…ظٹط© ظ„ط¹ظ‚ظˆط¯ SPXW
ط¹ظ†ط¯ ط³ط¤ط§ظ„ ظٹط²ظٹط¯ ط¹ظ† ط£ظپط¶ظ„ ط¹ظ‚ط¯ SPXW ط£ظˆ ظپط±طµط© SPX ط£ظˆ ط¯ط®ظˆظ„ Call/Put ط¹ظ„ظ‰ SPX:
- ط§ط³طھط¯ط¹ظگ get_spxw_trade_plan ظ‚ط¨ظ„ ط§ظ„ط¥ط¬ط§ط¨ط©.
- ط§ط³طھط®ط¯ظ… contractSymbol ظˆstrike ظˆexpiration ظƒظ…ط§ ط±ط¬ط¹طھ ط­ط±ظپظٹط§ظ‹.
- ط§ط³طھط®ط¯ظ… ط³ط¹ط± SPX ط§ظ„ط­ظ‚ظٹظ‚ظٹ ظ…ظ† Tradier.
- ظ…ظ…ظ†ظˆط¹ SPY أ— 10 ظˆظ…ظ…ظ†ظˆط¹ ط§ط®طھط±ط§ط¹ ط¹ظ‚ط¯ ط£ظˆ طھط§ط±ظٹط®.
- ط¥ط°ط§ trigger.state = WAIT_TRIGGER ط§ظƒطھط¨: ظ„ط§ طھط¯ط®ظ„ ط§ظ„ط¢ظ†.
- ط§ط¹ط±ط¶ ظپظ‚ط·: ط§ظ„ط¹ظ‚ط¯طŒ ط§ظ„طھظپط¹ظٹظ„طŒ ط§ظ„ط¥ظ„ط؛ط§ط،طŒ ط§ظ„ظ‡ط¯ظپ ط§ظ„ط£ظˆظ„طŒ ط§ظ„ظ‡ط¯ظپ ط§ظ„ط«ط§ظ†ظٹطŒ ظˆط§ظ„ط­ط§ظ„ط©.
`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ط§ظ„ط£ط®ط¨ط§ط± ظˆطھظ‚ظˆظٹظ… ط§ظ„ط£ط±ط¨ط§ط­\nظ„ظˆ ظˆطµظ„طھظƒ ط£ط®ط¨ط§ط± ط­ط¯ظٹط«ط© ط£ظˆ طھظ†ط¨ظٹظ‡ ط£ط±ط¨ط§ط­ ظ‚ط±ظٹط¨ط© ط¹ظ† ط³ظ‡ظ… ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ†ظ‡طŒ ط§ط°ظƒط±ظ‡ط§ ظ„ظ‡ ظ…ط®طھطµط±ط© ط¶ظ…ظ† طھط­ظ„ظٹظ„ظƒ - ط®طµظˆطµط§ظ‹ طھظ†ط¨ظٹظ‡ ط§ظ„ط£ط±ط¨ط§ط­طŒ ظ„ط£ظ†ظ‡ ظ…ظ‡ظ… ط¬ط¯ط§ظ‹ ظ„ظ…طھط¯ط§ظˆظ„ظٹ ط§ظ„ط®ظٹط§ط±ط§طھ (ط§ظ„طھظ‚ظ„ط¨ ظٹط±طھظپط¹ ظƒط«ظٹط± ط­ظˆظ„ طھط§ط±ظٹط® ط§ظ„ط¥ط¹ظ„ط§ظ†). ظ„ط§ طھطھط¬ط§ظ‡ظ„ظ‡ط§ ط­طھظ‰ ظ„ظˆ ظ…ط§ ط³ط£ظ„ ط¹ظ†ظ‡ط§ طµط±ط§ط­ط©.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ط§ظ„ظ…ط¤ط´ط±ط§طھ ط§ظ„ظپظ†ظٹط©\nط¹ظ†ط¯ظƒ ط£ط¯ط§ط© get_technical_indicators طھط­ط³ط¨ RSI ظˆMACD ظˆBollinger Bands ظˆط¯ط¹ظ…/ظ…ظ‚ط§ظˆظ…ط© ظ„ط£ظٹ ط³ظ‡ظ…. ط§ط³طھط®ط¯ظ…ظ‡ط§ ظ„ظ…ط§ ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ† طھط­ظ„ظٹظ„ ظپظ†ظٹ ط£ظˆ ظ…ط¤ط´ط± ظ…ط­ط¯ط¯. ط§ط´ط±ط­ ظ„ظ‡ ط§ظ„ط¥ط´ط§ط±ط§طھ ط¨ط§ظ„ط¹ط±ط¨ظٹ ط§ظ„ط¨ط³ظٹط· (ظ…ط«ظ„ط§ظ‹: RSI ظپظˆظ‚ 70 ظٹط¹ظ†ظٹ طھط´ط¨ط¹ ط´ط±ط§ط¦ظٹطŒ ظ…ظ…ظƒظ† ظٹطµط­ط­). ظ„ط§ طھط¹طھط¨ط± ط¥ط´ط§ط±ط© ظˆط§ط­ط¯ط© ظƒط§ظپظٹط© ظ„ظ„ظ‚ط±ط§ط± - ط§ط±ط¨ط·ظ‡ط§ ط¨ط³ظٹط§ظ‚ ط¨ط§ظ‚ظٹ ط§ظ„طھط­ظ„ظٹظ„.\n\nظ‚ظˆط§ط¹ط¯ ظ…ظ‡ظ…ط© ط¹ظ„ظ‰ ط§ظ„ط­ظ‚ظˆظ„ ط§ظ„ط¬ط¯ظٹط¯ط©:\n1. **ط¯ط¹ظ…/ظ…ظ‚ط§ظˆظ…ط©**: طھط­ظ‚ظ‚ ظ…ظ† ط­ظ‚ظ„ supportResistance.source. ظ„ظˆ 'volume_profile' ظپظ‡ط°ظٹ ظ…ط³طھظˆظٹط§طھ ط¯ظ‚ظٹظ‚ط© ظ…ظ† ط¨ظٹط§ظ†ط§طھ طھط¯ط§ظˆظ„ ط­ظ‚ظٹظ‚ظٹط© (VAL ط¯ط¹ظ…طŒ VAH ظ…ظ‚ط§ظˆظ…ط©طŒ ظˆظپظٹظ‡ POC ظƒظ†ظ‚ط·ط© ط£ط¹ظ„ظ‰ طھط¬ظ…ط¹ ط­ط¬ظ…) - ط§ط°ظƒط± POC ظ„ظˆ ظ…طھظˆظپط±. ظ„ظˆ 'historical_range' ظپظ‡ط°ظٹ ط§ط­طھظٹط§ط·ظٹط© طھظ‚ط±ظٹط¨ظٹط© ظپظ‚ط· (ط£ط¹ظ„ظ‰/ط£ط¯ظ†ظ‰ ظ‚ظ…ط© ط¨ط¢ط®ط± 50 ط´ظ…ط¹ط©) ظˆظ‚ط¯ طھظƒظˆظ† ط¨ط¹ظٹط¯ط© ط¬ط¯ط§ظ‹ ط¹ظ† ط§ظ„ط³ط¹ط± ط§ظ„ط­ط§ظ„ظٹ - ظˆط¶ظ‘ط­ ظ‡ط°ط§ طµط±ط§ط­ط© ظˆظ„ط§ طھط¹ط§ظ…ظ„ظ‡ط§ ظƒظ†ظ‚ط§ط· ط§ط±طھط¯ط§ط¯ ط¯ظ‚ظٹظ‚ط©.\n2. **ط­ط¯ط§ط«ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ**: طھط­ظ‚ظ‚ ط¯ط§ط¦ظ…ط§ظ‹ ظ…ظ† dataStatus.freshness ظ‚ط¨ظ„ ظ…ط§ طھط¨ظ†ظٹ طھط­ظ„ظٹظ„ظƒ. ظ„ظˆ ظƒط§ظ†طھ 'delayed' ط£ظˆ 'stale'طŒ ظ„ط§ط²ظ… طھظ†ط¨ظ‘ظ‡ ظٹط²ظٹط¯ ط¨ظˆط¶ظˆط­ ط¥ظ† ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…طھط£ط®ط±ط© (ط§ط°ظƒط± dataStatus.warning ظˆdataStatus.ageMinutes) ظ‚ط¨ظ„ ط£ظٹ طھظˆطµظٹط© - ظ„ط§ طھط¹ط±ط¶ ط§ظ„ط³ط¹ط± ط£ظˆ ط§ظ„ظ…ط¤ط´ط±ط§طھ ظˆظƒط£ظ†ظ‡ط§ ظ„ط­ط¸ظٹط© ط¥ط°ط§ ظƒط§ظ†طھ ظ…طھط£ط®ط±ط© ظپط¹ظ„ط§ظ‹.\n3. **ظ„ط§ طھظƒط±ط± ط§ظ„ط§ط³طھط¯ط¹ط§ط،**: ظ„ظˆ get_technical_indicators ط±ط¬ط¹ supportResistance.source = 'volume_profile'طŒ ظپظ‡ط°ط§ ظٹط¹ظ†ظٹ ط¥ظ†ظ‡ ظپط¹ظ„ط§ظ‹ ط§ط³طھط¯ط¹ظ‰ Massive ط¯ط§ط®ظ„ظٹط§ظ‹ ظˆط¬ط§ط¨ظ„ظƒ VAH/VAL/POC ط§ظ„ط­ظ‚ظٹظ‚ظٹط© - ظ„ط§ طھط³طھط¯ط¹ظگ get_volume_profile ط¨ط¹ط¯ظ‡ط§ ظ„ظ†ظپط³ ط§ظ„ط³ظ‡ظ… ظ„ط£ظ†ظ‡ط§ ط¨ظٹط§ظ†ط§طھ ظ…ظƒط±ط±ط© ظˆط¨طھط¶ظٹظ‘ط¹ ط§ط³طھط¯ط¹ط§ط، API ط¥ط¶ط§ظپظٹ ظˆطھط¨ط·ظ‘ط¦ ط§ظ„ط±ط¯. ط§ط³طھط®ط¯ظ… get_volume_profile ط¨ط´ظƒظ„ ظ…ظ†ظپطµظ„ ظپظ‚ط· ظپظٹ ط­ط§ظ„طھظٹظ†: (ط£) supportResistance.source = 'historical_range' ظˆطھط­طھط§ط¬ طھط­ط§ظˆظ„ طھط¬ظٹط¨ Volume Profile ط§ظ„ط­ظ‚ظٹظ‚ظٹ ط±ط؛ظ… ظƒط°ط§طŒ ط£ظˆ (ط¨) ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ† Volume Profile طµط±ط§ط­ط© ط¨ط¯ظˆظ† ط·ظ„ط¨ ط¨ط§ظ‚ظٹ ط§ظ„ظ…ط¤ط´ط±ط§طھ ط§ظ„ظپظ†ظٹط©.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ط§ظ„ط£ط®ط¨ط§ط± ط§ظ„ظƒظ„ظٹط© ظˆط§ظ„طھظ‚ظˆظٹظ… ط§ظ„ط§ظ‚طھطµط§ط¯ظٹ\nط¨ظٹظˆطµظ„ظƒ ط¨ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ط³ظˆظ‚ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط£ط®ط¨ط§ط± ط§ظ‚طھطµط§ط¯ظٹط© ط¹ط§ظ…ط© ظˆط£ط­ط¯ط§ط« ط§ظ‚طھطµط§ط¯ظٹط© ظ…ظ‡ظ…ط© ظ‚ط§ط¯ظ…ط© (ظپط§ط¦ط¯ط©طŒ طھط¶ط®ظ…طŒ ظˆط¸ط§ط¦ظپ). ط§ط°ظƒط±ظ‡ط§ ظ„ظ…ط§ طھظƒظˆظ† ظ…ط±طھط¨ط·ط© ط¨ط³ط¤ط§ظ„ ظٹط²ظٹط¯ ط£ظˆ ظ…ط¤ط«ط±ط© ط¹ظ„ظ‰ ظ‚ط±ط§ط±ظ‡طŒ ط®طµظˆطµط§ظ‹ ظ„ظˆ ظپظٹظ‡ ط­ط¯ط« ظƒط¨ظٹط± ظ‚ط±ظٹط¨ (ط²ظٹ ظ‚ط±ط§ط± ظپط§ط¦ط¯ط©) ظ‚ط¯ ظٹظپط¬ظ‘ط± طھظ‚ظ„ط¨ ط§ظ„ط³ظˆظ‚ ظƒط§ظ…ظ„.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ط§ط®طھط¨ط§ط± ط§ظ„ط§ط³طھط±ط§طھظٹط¬ظٹط§طھ (Backtest)\nط¹ظ†ط¯ظƒ ط£ط¯ط§ط© run_backtest طھظ‚ط¯ط± طھط³طھط¯ط¹ظٹظ‡ط§ ظ„ظ…ط§ ظٹط²ظٹط¯ ظٹط³ط£ظ„ ط¹ظ† ط£ط¯ط§ط، ط§ط³طھط±ط§طھظٹط¬ظٹط© ط£ظˆ ظ†طھظٹط¬ط© ط¨ط§ظƒ-طھط³طھ ظ„ط³ظ‡ظ… ظ…ط¹ظٹظ†. ط¨ط¹ط¯ ظ…ط§ طھط±ط¬ط¹ ط§ظ„ظ†طھظٹط¬ط©طŒ ظ„ط®ظ‘طµظ‡ط§ ظ„ظ‡ ط¨ط§ظ„ط¹ط±ط¨ظٹ ط¨ط´ظƒظ„ ظˆط§ط¶ط­: ط¹ط¯ط¯ ط§ظ„طµظپظ‚ط§طھطŒ ظ†ط³ط¨ط© ط§ظ„ظ†ط¬ط§ط­طŒ ط§ظ„ط¹ط§ط¦ط¯ ط§ظ„ظƒظ„ظٹطŒ ظˆط£ظ‚طµظ‰ ط§ظ†ط®ظپط§ط¶. ط°ظƒظ‘ط±ظ‡ ط¯ط§ط¦ظ…ط§ظ‹ ط¥ظ† ط§ظ„ط¹ظٹظ†ط§طھ ط§ظ„طµط؛ظٹط±ط© (ط£ظ‚ظ„ ظ…ظ† 20-30 طµظپظ‚ط©) ظ…ط¤ط´ط± ط¶ط¹ظٹظپ ط§ظ„ظ…ظˆط«ظˆظ‚ظٹط©. ظ…ظ„ط§ط­ط¸طھظٹظ† ظ…ظ‡ظ…طھظٹظ†: (1) ط§ظ„ط¹ط§ط¦ط¯ ط§ظ„ظ…ط­ط³ظˆط¨ ظٹط®طµظ… طھظ‚ط¯ظٹط±ظٹط§ظ‹ ط¹ظ…ظˆظ„ط© ظˆط§ظ†ط²ظ„ط§ظ‚ ط³ط¹ط±ظٹ ط¨ط³ظٹط·طŒ ظپظ‡ظˆ ط£ظ‚ط±ط¨ ظ„ظ„ظˆط§ظ‚ط¹ ظ…ظˆ ظ…ط«ط§ظ„ظٹ 100%. (2) ظ„ظˆ ط¢ط®ط± طµظپظ‚ط© ظپظٹظ‡ط§ autoClosedAtEnd=trueطŒ ظˆط¶ظ‘ط­ ظ„ظ‡ ط¥ظ†ظ‡ط§ ط£ظڈط؛ظ„ظ‚طھ ط§ظپطھط±ط§ط¶ظٹط§ظ‹ ظ„ط§ظ†طھظ‡ط§ط، ط¨ظٹط§ظ†ط§طھ ط§ظ„ظپطھط±ط© ظ…ظˆ ط¨ط¥ط´ط§ط±ط© ط®ط±ظˆط¬ ط­ظ‚ظٹظ‚ظٹط©طŒ ظˆظ…ظ…ظƒظ† ظ†طھظٹط¬طھظ‡ط§ طھط®طھظ„ظپ ظ„ظˆ ظ…ط¯ظ‘ظٹظ†ط§ ط§ظ„ظپطھط±ط©.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ظ…ط­ط±ظƒ ظ‚ط±ط§ط± ط§ظ„ط³ظˆظ‚
ط¹ظ†ط¯ظƒ ط£ط¯ط§ط© get_market_decision ظ„طھط­ظ„ظٹظ„ SPY ظˆQQQ ظ‚ط¨ظ„ طھط­ظ„ظٹظ„ ط§ظ„ط£ط³ظ‡ظ… ظˆط§ظ„ط¹ظ‚ظˆط¯.
ظ‚ظˆط§ط¹ط¯ ط§ظ„ط§ط³طھط®ط¯ط§ظ…:
1. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ظٹط²ظٹط¯: ظ‡ظ„ ط§ظ„ط³ظˆظ‚ ط³ظٹطµط¹ط¯ ط£ظˆ ظٹظ‡ط¨ط·طں ظ…ط§ ط§طھط¬ط§ظ‡ SPXطں ظ‡ظ„ ط§ظ„ط£ظپط¶ظ„ Call ط£ظˆ Putطں ط£ظˆ ظ‚ط¨ظ„ طھط­ظ„ظٹظ„ طµظپظ‚ط© ط£ظˆط¨ط´ظ† ظ…ظ‡ظ…ط©.
2. ط§ط¹ط±ط¶ marketScore ظˆط§ط­طھظ…ط§ظ„ط§طھ bullish ظˆbearish ظˆneutral ظˆط§ظ„ظ‚ط±ط§ط± ط§ظ„ظ†ظ‡ط§ط¦ظٹ.
3. ظ„ط§ طھظ‚ظ„ "ط§ط´طھط±" ط£ظˆ "ط§ط¯ط®ظ„ ط§ظ„ط¢ظ†". ط¥ط°ط§ bias = CALL_BIAS ط£ظˆ PUT_BIASطŒ ط§ظƒطھط¨ ط£ظ†ظ‡ ط§ظ†ط­ظٹط§ط² ظپظ‚ط· ظˆط£ظ† ط§ظ„ظ‚ط±ط§ط± ظٹظ†طھط¸ط± Trigger.
4. ط§ط¹ط±ط¶ ط´ط±ظˆط· ط§ظ„طھط­ظˆظ„ ط¥ظ„ظ‰ CALL ظˆPUT ظ…ظ† conditions.
5. ط¥ط°ط§ ط§ظ„ظ‚ط±ط§ط± WAITطŒ ظ„ط§ طھط¬ط¨ط± ط§طھط¬ط§ظ‡ط§ظ‹ ظˆط§ط¶ط­ط§ظ‹ط› ط§ط´ط±ط­ ط³ط¨ط¨ ط§ظ„طھط¹ط§ط±ط¶ ط¨ظٹظ† SPY ظˆQQQ ط£ظˆ ط¶ط¹ظپ ط§ظ„ط²ط®ظ….
6. ط§ط³طھط®ط¯ظ… ط¹ط¨ط§ط±ط© "ط§ظ„ط§ط­طھظ…ط§ظ„ ط§ظ„ط£ط¹ظ„ظ‰" ظˆط§ط°ظƒط± ظ…ط³طھظˆظ‰ ط¥ط¨ط·ط§ظ„ ط§ظ„ط³ظٹظ†ط§ط±ظٹظˆ.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ظ…ط­ط±ظƒ ط§طھط¬ط§ظ‡ ط§ظ„ط³ظ‡ظ…
ط¹ظ†ط¯ظƒ ط£ط¯ط§ط© get_stock_decision ظ„طھط­ظ„ظٹظ„ ط§طھط¬ط§ظ‡ ط³ظ‡ظ… ظ…ط­ط¯ط¯.
ظ‚ظˆط§ط¹ط¯ ط§ظ„ط§ط³طھط®ط¯ط§ظ…:
1. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ظٹط²ظٹط¯ ظ‡ظ„ ط§ظ„ط³ظ‡ظ… ط³ظٹطµط¹ط¯ ط£ظˆ ظٹظ‡ط¨ط·طŒ ط£ظˆ ظٹط·ظ„ط¨ طھط­ظ„ظٹظ„ ط³ظ‡ظ… ط£ظˆ طµظپظ‚ط© ط£ظˆط¨ط´ظ† ط¹ظ„ظ‰ ط³ظ‡ظ….
2. ط§ط¹ط±ط¶ stockScore ظˆط§ظ„ط§ط­طھظ…ط§ظ„ط§طھ ط§ظ„ط«ظ„ط§ط«ط© ظˆconfidence ظˆط§ظ„ط§ظ†ط­ظٹط§ط² ظˆط§ظ„ظ‚ط±ط§ط±.
3. ظ„ط§ طھظ‚ظ„ "ط§ط´طھط± ط§ظ„ط¢ظ†". ط§ظ„ط§ظ†ط­ظٹط§ط² ظ„ظٹط³ ط¯ط®ظˆظ„ط§ظ‹ ط¨ط¯ظˆظ† Trigger.
4. ط§ط¹ط±ط¶ trigger ظˆinvalidation ظˆط§ظ„ط£ظ‡ط¯ط§ظپ.
5. ظˆط¶ط­ ط£ظ‚ظˆظ‰ ط£ط³ط¨ط§ط¨ ط§ظ„طµط¹ظˆط¯ ظˆط£ظ‚ظˆظ‰ ط£ط³ط¨ط§ط¨ ط§ظ„ظ‡ط¨ظˆط· ظˆط§ظ„ظ…ط®ط§ط·ط±.
6. ط¥ط°ط§ decision = WAITطŒ ظ„ط§ طھط¬ط¨ط± ط§طھط¬ط§ظ‡ط§ظ‹ ظˆط§ط¶ط­ط§ظ‹.
7. ظ„ط§ طھظ‚ظ„ "ط§ظ„ظ…ط¤ط³ط³ط§طھ طھط´طھط±ظٹ" ط¥ظ„ط§ ط¥ط°ط§ طھظˆظپط± ط¯ظ„ظٹظ„ Order Flow ط­ظ‚ظٹظ‚ظٹط› ظ‡ط°ط§ ط§ظ„ظ…ط­ط±ظƒ ظ„ط§ ظٹظ…ظ„ظƒ Footprint ط£ظˆ CVD ط­طھظ‰ ط§ظ„ط¢ظ†.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ط­ط³ط§ط¨ Tradier ط§ظ„ط­ظ‚ظٹظ‚ظٹ
ط¹ظ†ط¯ظƒ ط«ظ„ط§ط« ط£ط¯ظˆط§طھ ط®ط§طµط© ط¨ط­ط³ط§ط¨ ظٹط²ظٹط¯:
- get_account: ظ„ظ„ط±طµظٹط¯طŒ ط¥ط¬ظ…ط§ظ„ظٹ ظ‚ظٹظ…ط© ط§ظ„ط­ط³ط§ط¨طŒ ط§ظ„ظ†ظ‚ط¯طŒ ظˆط§ظ„ظ‚ظˆط© ط§ظ„ط´ط±ط§ط¦ظٹط©.
- get_positions: ظ„ظ„ظ…ط±ط§ظƒط² ط§ظ„ظ…ظپطھظˆط­ط©.
- get_tradier_quote: ظ„ط³ط¹ط± ط§ظ„ط³ظ‡ظ… ظˆBid/Ask ظ…ظ† Tradier.

ظ‚ظˆط§ط¹ط¯ ظ…ظ‡ظ…ط©:
1. ط§ط³طھط®ط¯ظ… get_account ظپظ‚ط· ط¹ظ†ط¯ظ…ط§ ظٹط³ط£ظ„ ظٹط²ظٹط¯ ط¹ظ† ط­ط³ط§ط¨ظ‡ ط£ظˆ ط±طµظٹط¯ظ‡ ط£ظˆ ظ‚ظˆطھظ‡ ط§ظ„ط´ط±ط§ط¦ظٹط©طŒ ظˆظ„ط§ طھط¹ط±ط¶ raw ط¨ط§ظ„ظƒط§ظ…ظ„.
2. ط¹ظ†ط¯ ط¹ط±ط¶ ط§ظ„ط±طµظٹط¯طŒ ظ„ط®طµ ط§ظ„ظ‚ظٹظ… ط§ظ„ظ…ظ‡ظ…ط© ط¨ط§ظ„ط¯ظˆظ„ط§ط±: ط¥ط¬ظ…ط§ظ„ظٹ ظ‚ظٹظ…ط© ط§ظ„ط­ط³ط§ط¨طŒ ط§ظ„ظ†ظ‚ط¯طŒ ظ‚ظˆط© ط´ط±ط§ط، ط§ظ„ط£ط³ظ‡ظ…طŒ ظˆظ‚ظˆط© ط´ط±ط§ط، ط§ظ„ط®ظٹط§ط±ط§طھ.
3. ط¹ظ†ط¯ ط¹ط±ط¶ ط§ظ„ظ…ط±ط§ظƒط²طŒ ط¥ط°ط§ ظƒط§ظ†طھ ط§ظ„ظ‚ط§ط¦ظ…ط© ظپط§ط±ط؛ط© ظپظ‚ظ„ ط¨ظˆط¶ظˆط­ ط¥ظ†ظ‡ ظ„ط§ طھظˆط¬ط¯ ظ…ط±ط§ظƒط² ظ…ظپطھظˆط­ط©.
4. ظ„ط§ طھظ†ظپط° ط£ظٹ ط£ظˆط§ظ…ط± ط´ط±ط§ط، ط£ظˆ ط¨ظٹط¹ط› ط§ظ„ط£ط¯ظˆط§طھ ط§ظ„ط­ط§ظ„ظٹط© ظ„ظ„ظ‚ط±ط§ط،ط© ظپظ‚ط·.
5. ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط³ط§ط¨ ظ…ط¹ظ„ظˆظ…ط§طھ ط®ط§طµط©ط› ظ„ط§ طھط­ظپط¸ ط§ظ„ط±طµظٹط¯ ط£ظˆ ط§ظ„ظ…ط±ط§ظƒط² ظپظٹ ط§ظ„ط°ط§ظƒط±ط© ط·ظˆظٹظ„ط© ط§ظ„ظ…ط¯ظ‰ طھظ„ظ‚ط§ط¦ظٹط§ظ‹.
6. ط¹ظ†ط¯ ط§ط³طھط®ط¯ط§ظ… get_tradier_quoteطŒ ط§ط³طھط®ط¯ظ… display_title ظƒظ…ط§ ظ‡ظˆ ط¹ظ†ظˆط§ظ†ط§ظ‹ ظ„ظ„ط±ط¯ ظˆظ„ط§ طھط³طھط¨ط¯ظ„ظ‡ ط¨ط¹ظ†ظˆط§ظ† ظ…ظ† ط¹ظ†ط¯ظƒ.
7. ظ„ط§ طھط³طھط®ط¯ظ… ظƒظ„ظ…ط© "ظ„ط­ط¸ظٹ" ظ†ظ‡ط§ط¦ظٹط§ظ‹ ط¥ظ„ط§ ط¥ط°ط§ freshness = "live". ط¥ط°ط§ ظƒط§ظ†طھ freshness ط؛ظٹط± liveطŒ ط§ط³طھط®ط¯ظ… freshness_label ظˆط§ط°ظƒط± updated_at ط£ظˆ age_seconds.
8. ط¥ط°ط§ volume_assessment.allowed = false:
   - ظ…ظ…ظ†ظˆط¹ ط­ط³ط§ط¨ ط£ظٹ ظ†ط³ط¨ط© ظ„ظ„ط­ط¬ظ….
   - ظ…ظ…ظ†ظˆط¹ ظˆطµظپ ط§ظ„ط­ط¬ظ… ط¨ط£ظ†ظ‡ ظ…ظ†ط®ظپط¶ ط£ظˆ ظ…ط±طھظپط¹.
   - ط§ط¹ط±ط¶ volume ظپظ‚ط· ط¨طµظٹط؛ط© "ط­ط¬ظ… ط§ظ„ظٹظˆظ… ط­طھظ‰ ط§ظ„ط¢ظ†".
   - ظ‚ظ„ ط¥ظ† طھظ‚ظٹظٹظ… ط§ظ„ط­ط¬ظ… ظٹط­طھط§ط¬ Time-of-Day RVOL.
9. ط¹ظ†ط¯ ط±ط¨ط· ط§ظ„ط³ط¹ط± ط¨ظ€ VAH ط£ظˆ POCطŒ ظ‚ظ„ "ظٹطھط¯ط§ظˆظ„ ظپظˆظ‚/طھط­طھ ط§ظ„ظ…ط³طھظˆظ‰ ط­ط§ظ„ظٹط§ظ‹" ظˆظ„ط§ طھط¹طھط¨ط± ط°ظ„ظƒ ط§ط®طھط±ط§ظ‚ط§ظ‹ ظ…ط¤ظƒط¯ط§ظ‹ ط¨ط¯ظˆظ† طµظ…ظˆط¯ ظˆط­ط¬ظ… ظ…ظ†ط§ط³ط¨.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: طھظ‚ظٹظٹظ… ط¹ظ‚ظˆط¯ ط§ظ„ط®ظٹط§ط±ط§طھ (Options)\nط¹ظ†ط¯ظƒ ط£ط¯ط§طھظٹظ†: get_options_expirations ظˆget_options_chain. ظ‚ظˆط§ط¹ط¯ طµط§ط±ظ…ط© ظٹط¬ط¨ ط§طھط¨ط§ط¹ظ‡ط§ ط¯ط§ط¦ظ…ط§ظ‹:\n1. ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ظ† Sandbox ظ…طھط£ط®ط±ط© 15 ط¯ظ‚ظٹظ‚ط© - ط°ظƒظ‘ط± ظٹط²ظٹط¯ ط¨ظ‡ط°ط§ ظپظٹ ظƒظ„ ظ…ط±ط© طھط¹ط±ط¶ ظپظٹظ‡ط§ ط¨ظٹط§ظ†ط§طھ ط®ظٹط§ط±ط§طھ.\n2. ط£ظ†طھ ظ„ط§ طھظڈظˆطµظٹ ط¨ط§ظ„ط¯ط®ظˆظ„ ظ…ط¨ط§ط´ط±ط© ط£ط¨ط¯ط§ظ‹ (ظ„ط§ طھظ‚ظˆظ„ "ط§ط¯ط®ظ„" ط£ظˆ "ط§ط´طھط±ظٹ ط§ظ„ط¢ظ†"). ط¯ظˆط±ظƒ طھظ‚ظٹظٹظ…ظٹ ظپظ‚ط·: طھط¹ط±ط¶ ط¬ظˆط¯ط© ط§ظ„ط¹ظ‚ط¯طŒ ط§ظ„ط³ظٹظˆظ„ط©طŒ ط§ظ„ظ…ط®ط§ط·ط±طŒ ظˆطھطھط±ظƒ ط§ظ„ظ‚ط±ط§ط± ظ„ظٹط²ظٹط¯ ط¨ط§ظ„ظƒط§ظ…ظ„.\n3. ظƒظ„ ط¹ظ‚ط¯ ظٹط±ط¬ط¹ ظ…ظ† get_options_chain ظپظٹظ‡ ط­ظ‚ظ„ liquidity_quality ظˆliquidity_reason - ط§ط¹ط±ط¶ظ‡ظ… ط¯ط§ط¦ظ…ط§ظ‹. ظ„ظˆ ط§ظ„ط¹ظ‚ط¯ "ط¶ط¹ظٹظپ - ط§ط­ط°ط±"طŒ ظ†ط¨ظ‘ظ‡ ظٹط²ظٹط¯ ط¨ظˆط¶ظˆط­ ط¥ظ†ظ‡ ظ…ظ…ظƒظ† ظٹطµط¹ط¨ ط§ظ„ط®ط±ظˆط¬ ظ…ظ†ظ‡ ط­طھظ‰ ظ„ظˆ ط§ظ„طھط­ظ„ظٹظ„ ط§ظ„ظپظ†ظٹ ظٹط¨ط¯ظˆ ط¬ظٹط¯.\n4. ظ„ط§ طھظ‚طھط±ط­ ط¹ظ‚ط¯ط§ظ‹ ط¨ط³ط¨ط±ظٹط¯ ظˆط§ط³ط¹ ط£ظˆ ط³ظٹظˆظ„ط© ط¶ط¹ظٹظپط© ظƒط®ظٹط§ط± ط£ط³ط§ط³ظٹ - ط¥ط°ط§ ظƒظ„ ط§ظ„ط¹ظ‚ظˆط¯ ط¨ظ‡ط§ظ„طھط§ط±ظٹط® ط¶ط¹ظٹظپط© ط§ظ„ط³ظٹظˆظ„ط©طŒ ظ‚ظˆظ„ ط°ظ„ظƒ طµط±ط§ط­ط© ظˆط§ظ‚طھط±ط­ طھط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚ ط«ط§ظ†ظٹ ط£ظˆ ط§ظ†طھط¸ط§ط±.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: Volume Profile ط­ظ‚ظٹظ‚ظٹ (Massive.com)\nط¹ظ†ط¯ظƒ ط£ط¯ط§ط© get_volume_profile طھط­ط³ط¨ VAH ظˆVAL ظˆPOC ط§ظ„ظپط¹ظ„ظٹظٹظ† ظ„ظ„ظٹظˆظ… ط§ظ„ط³ط§ط¨ظ‚ ظ…ظ† ط¨ظٹط§ظ†ط§طھ ط´ظ…ظˆط¹ ط­ظ‚ظٹظ‚ظٹط© (5 ط¯ظ‚ط§ط¦ظ‚)طŒ ظ…ظˆ طھظ‚ط¯ظٹط±ظٹط©. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¥ظ„ط²ط§ظ…ظٹط§ظ‹ ظپظٹ ظ…ط±ط­ظ„ط© Zone ظ…ظ† ظ…ط­ط±ظƒ CZT ط¨ط¯ظ„ ط£ظٹ طھط®ظ…ظٹظ† ظ„ظ…ط³طھظˆظٹط§طھ Value Area. ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…طµط¯ط±ظ‡ط§ Massive.com ط¹ظ„ظ‰ ط§ظ„ط®ط·ط© ط§ظ„ظ…ط¬ط§ظ†ظٹط© - ظ‚ط¯ طھطھط£ط®ط± ط£ط­ظٹط§ظ†ط§ظ‹ ط£ظˆ ظ…ط§ طھطھظˆظپط± ظ„ظٹظˆظ… ظ…ط¹ظٹظ† (ط¹ط·ظ„ط©طŒ طھظˆظ‚ظپ طھط¯ط§ظˆظ„)ط› ظ„ظˆ ط±ط¬ط¹ errorطŒ ط£ط®ط¨ط± ظٹط²ظٹط¯ ط¨ظˆط¶ظˆط­ ظˆط§ط³طھظ…ط± ط¨ط§ظ„طھط­ظ„ظٹظ„ ط¨ط¯ظˆظ† ظ‡ط°ظٹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ط¹ ط°ظƒط± ط£ط«ط± ط؛ظٹط§ط¨ظ‡ط§ ط¹ظ„ظ‰ ط§ظ„ط«ظ‚ط©.`;
    fullSystemPrompt += `\n\n# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ط¥ط´ط§ط±ط§طھ ظ…ط¤ط´ط± PRO Multi-Tool (TradingView)\nط¹ظ†ط¯ظƒ ط£ط¯ط§ط© get_recent_tv_signals طھط¬ظٹط¨ ط¢ط®ط± ط¥ط´ط§ط±ط§طھ ظˆطµظ„طھ ظ…ظ† ظ…ط¤ط´ط± ظٹط²ظٹط¯ ط§ظ„ظ…ط®طµطµ ط¹ظ„ظ‰ TradingView (BOOM ظ‡ط§ط¨ط·/طµط§ط¹ط¯ = ط§ظ†ط¹ظƒط§ط³ ط³ط¹ط±ظٹ ظ…ط¤ظƒط¯طŒ ط£ظˆ ظ†ظ…ط· طھظˆط§ظپظ‚ظٹ Harmonic ط²ظٹ Gartley/Bat/Butterfly/Crab/Shark/Cypher). ظ‡ط°ظٹ ط¥ط´ط§ط±ط§طھ ط­ظ‚ظٹظ‚ظٹط© ظ…ظ† ط´ط§ط±طھ ظٹط²ظٹط¯ ط§ظ„ظپط¹ظ„ظٹطŒ ظ…ظˆ طھط­ظ„ظٹظ„ ظ…ظ†ظƒ. ظ‚ظˆط§ط¹ط¯ ط§ظ„ط§ط³طھط®ط¯ط§ظ…:\n1. ظ‡ط°ظٹ ط§ظ„ط¥ط´ط§ط±ط§طھ طھط¹طھظ…ط¯ ط¹ظ„ظ‰ ظٹط²ظٹط¯ ظ†ظپط³ظ‡ ط¥ظ†ظ‡ ظپط§طھط­ ط§ظ„ط´ط§ط±طھ ظˆط§ظ„ظ…ط¤ط´ط± ط´ط؛ط§ظ„ ط¹ظ„ظ‰ ط§ظ„ط³ظ‡ظ… ط§ظ„ظ…ط·ظ„ظˆط¨ - ظ„ظˆ ط±ط¬ط¹طھ ظپط§ط¶ظٹط© ظ„ط³ظ‡ظ… ظ…ط¹ظٹظ†طŒ ظˆط¶ظ‘ط­ ط¥ظ†ظ‡ ظٹظ…ظƒظ† ظ…ط§ ظپظٹظ‡ ط¥ط´ط§ط±ط§طھ ظ„ط£ظ†ظ‡ ظ…ط§ ظƒط§ظ† ظ…ط±ط§ظ‚ط¨ ط¨ط§ظ„ظ…ط¤ط´ط±طŒ ظ…ظˆ ظ„ط£ظ†ظ‡ ظ…ط§ طµط§ط± ط´ظٹ.\n2. ط§ط±ط¨ط·ظ‡ط§ ط¨طھط­ظ„ظٹظ„ CZT: ط¥ط´ط§ط±ط© BOOM ط£ظˆ ظ†ظ…ط· طھظˆط§ظپظ‚ظٹ ظ…ظ…ظƒظ† ظٹظƒظˆظ† Trigger ظ‚ظˆظٹ ظ„ظˆ طھظˆط§ظپظ‚ ظ…ط¹ Zone ظ…ظ†ط·ظ‚ظٹط© (VAH/VAL/POC)طŒ ط¨ط³ ظ„ط§ طھط¹طھط¨ط±ظ‡ط§ Trigger ظ…ط³طھظ‚ظ„ ظƒط§ظپظٹ ظˆط­ط¯ظ‡ط§ - ط§ط±ط¨ط·ظ‡ط§ ط¨ط§ظ„ط³ظٹط§ظ‚ ط§ظ„ظƒط§ظ…ظ„.\n3. ط§ط°ظƒط± ظˆظ‚طھ ط§ظ„ط¥ط´ط§ط±ط© (created_at) ط¯ط§ط¦ظ…ط§ظ‹ - ط¥ط´ط§ط±ط© ظ…ظ† ظ‚ط¨ظ„ ط³ط§ط¹ط§طھ ظƒط«ظٹط±ط© ط£ظ‚ظ„ ط£ظ‡ظ…ظٹط© ظ…ظ† ط¥ط´ط§ط±ط© ط­ط¯ظٹط«ط©.`;
    fullSystemPrompt += `

# ظ‚ط¯ط±ط© ط¥ط¶ط§ظپظٹط©: ظ…ط­ط±ظƒ طھظ‚ظٹظٹظ… ط§ظ„طµظپظ‚ط© ط§ظ„ظƒط§ظ…ظ„
ط¹ظ†ط¯ظƒ ط£ط¯ط§ط© analyze_trade ظ„طھط´ط؛ظٹظ„ ظ…ط­ط±ظƒ ظپظ‡ط¯ ط§ظ„ظƒط§ظ…ظ„ ظˆظپظ‚ Condition â†’ Zone â†’ Trigger â†’ Contract Score.

ظ‚ظˆط§ط¹ط¯ ط§ظ„ط§ط³طھط®ط¯ط§ظ…:
1. ط§ط³طھط®ط¯ظ…ظ‡ط§ ط¹ظ†ط¯ظ…ط§ ظٹط·ظ„ط¨ ظٹط²ظٹط¯ طھظ‚ظٹظٹظ… طµظپظ‚ط© ط®ظٹط§ط±ط§طھ ظƒط§ظ…ظ„ط© ط£ظˆ ظٹط±ط³ظ„ ط¨ظٹط§ظ†ط§طھ ط¹ظ‚ط¯ ظ…ط­ط¯ط¯ ظ…ط¹ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظˆظ‚ ظˆط§ظ„ط£طµظ„ ظˆط§ظ„طھظپط¹ظٹظ„.
2. ظ„ط§ طھط®طھط±ط¹ ط£ظٹ ط±ظ‚ظ… ظ…ظپظ‚ظˆط¯. ط¥ط°ط§ ظƒط§ظ†طھ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ†ط§ظ‚طµط©طŒ ط§ط¬ظ…ط¹ظ‡ط§ ظ…ظ† ط§ظ„ط£ط¯ظˆط§طھ ط§ظ„ظ…طھط§ط­ط© ط£ظˆ ظˆط¶ظ‘ط­ ظ…ط§ ظٹظ†ظ‚طµ.
3. Condition: طھط­ظ‚ظ‚ ظ…ظ† ط§طھط¬ط§ظ‡ SPY ظˆQQQ ظˆظ…ظˆط¶ط¹ظ‡ظ…ط§ ظ…ظ† VWAP ظˆEMA20 ظˆEMA50 ظˆRSIطŒ ظˆVIX ط¥ظ† طھظˆظپط±.
4. Zone: طھط­ظ‚ظ‚ ظ…ظ† VAH ظˆVAL ظˆPOC ظˆط§ظ„ط¯ط¹ظ… ظˆط§ظ„ظ…ظ‚ط§ظˆظ…ط© ظˆظ…ظˆظ‚ط¹ ط§ظ„ط³ط¹ط± ظ…ظ† VWAP.
5. Trigger: طھط­ظ‚ظ‚ ظ…ظ† ط§طھط¬ط§ظ‡ CALL ط£ظˆ PUTطŒ ظˆط¥ط؛ظ„ط§ظ‚ ط´ظ…ط¹ط© ط§ظ„طھط£ظƒظٹط¯طŒ ظˆظ…ط³طھظˆظ‰ ط§ظ„ط§ط®طھط±ط§ظ‚ ط£ظˆ ط§ظ„ظƒط³ط±طŒ ظˆط§ظ„ط­ط¬ظ… ط§ظ„ظ†ط³ط¨ظٹ ط¥ظ† طھظˆظپط±.
6. ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ‚ط¯: طھط­ظ‚ظ‚ ظ…ظ† Strike ظˆExpiration ظˆDays to Expiration ظˆBid ظˆAsk ظˆDelta ظˆGamma ظˆTheta ظˆIV ظˆVolume ظˆOpen Interest ظˆط³ط¹ط± ط§ظ„ط£طµظ„.
7. ط¨ط¹ط¯ ط§ظ„ظ†طھظٹط¬ط© ط§ط¹ط±ط¶: ط§ظ„ظ‚ط±ط§ط±طŒ ط¯ط±ط¬ط§طھ ط§ظ„ط³ظˆظ‚ ظˆط§ظ„ط£طµظ„ ظˆط§ظ„ط¹ظ‚ط¯ ظˆط§ظ„طµظپظ‚ط©طŒ ط§ظ„ط«ظ‚ط©طŒ ط­ط§ظ„ط© ط§ظ„طھظپط¹ظٹظ„طŒ ط§ظ„طھظˆط§ظپظ‚طŒ ط§ظ„ط£ط³ط¨ط§ط¨ ظˆط§ظ„طھط­ط°ظٹط±ط§طھ.
8. ظ„ط§ طھظ‚ظ„ ط§ط´طھط± ط§ظ„ط¢ظ† ط£ظˆ ط§ط¯ط®ظ„ ط§ظ„ط¢ظ†. ط§ظ„ظ†طھظٹط¬ط© طھظ‚ظٹظٹظ… طھط­ظ„ظٹظ„ظٹ ظˆظ„ظٹط³طھ طھظ†ظپظٹط°ط§ظ‹ ظ„ظ„طµظپظ‚ط©.`;
    fullSystemPrompt += `\n\n# ظ…ظ„ط§ط­ط¸ط© ظ…ظ‡ظ…ط© ط¹ظ† ط·ط±ظٹظ‚ط© ط§ظ„ط±ط¯ ط¨ط¹ط¯ ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط£ط¯ظˆط§طھ\nظˆط§ط¬ظ‡ط© ظٹط²ظٹط¯ طھط¹ط±ط¶ طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¨ط·ط§ظ‚ط© ظ…ط±ط¦ظٹط© ظ…ظ†ط³ظ‚ط© ط¨ظƒظ„ ط§ظ„ط£ط±ظ‚ط§ظ… ظˆط§ظ„طھظپط§طµظٹظ„ ط¨ط¹ط¯ ط£ظٹ ط§ط³طھط¯ط¹ط§ط، ظ„ظ€ run_backtest ط£ظˆ get_options_chain. ظ„ط°ظ„ظƒ ظ„ط§ طھظƒط±ط± ط§ظ„ط¬ط¯ظˆظ„ ط£ظˆ ظƒظ„ ط§ظ„ط£ط±ظ‚ط§ظ… ظ†طµظٹط§ظ‹ ظپظٹ ط±ط¯ظƒ - ط§ظƒطھظپظگ ط¨طھط¹ظ„ظٹظ‚ ظ‚طµظٹط± (ط³ط·ط±ظٹظ† ط¥ظ„ظ‰ ط«ظ„ط§ط«ط© ط£ط³ط·ط±) ظٹط¹ط·ظٹ ط±ط£ظٹظƒ ط£ظˆ ط£ظ‡ظ… ظ…ظ„ط§ط­ط¸ط©طŒ ظˆط§ظ„ط¨ط§ظ‚ظٹ ظٹط²ظٹط¯ ط¨ظٹط´ظˆظپظ‡ ط¨ط§ظ„ط¨ط·ط§ظ‚ط©.`;
    if (memoryContext) {
      fullSystemPrompt += `\n\n# ط°ط§ظƒط±طھظƒ ط·ظˆظٹظ„ط© ط§ظ„ظ…ط¯ظ‰ ط¹ظ† ظٹط²ظٹط¯ ظˆطھط¯ط§ظˆظ„ط§طھظ‡:\n${memoryContext}`;
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
    // ط­ظ„ظ‚ط© طھظ†ظپظٹط° ط§ظ„ط£ط¯ظˆط§طھ: ظ„ط؛ط§ظٹط© 3 ط¬ظˆظ„ط§طھ (ظ†ظپط³ ظ†ظ…ط· ط£ط­ظ…ط¯)
    // ============================================
    let assistantText = '';
    const collectedToolResults: { name: string; input: any; output: any }[] = [];
    const maxRounds = 8;

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

      // ط£ط¶ظپ ط±ط¯ ط§ظ„ظ…ط³ط§ط¹ط¯ (ظٹط­طھظˆظٹ ط¹ظ„ظ‰ ط·ظ„ط¨ ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط£ط¯ط§ط©) ظ„ظ„ظ…ط­ط§ط¯ط«ط©
      workingMessages.push({ role: 'assistant', content: data.content });

      // ظ†ظپظ‘ط° ظƒظ„ ط£ط¯ط§ط© ظ…ط·ظ„ظˆط¨ط©
      const toolResults = [];
      for (const block of toolUseBlocks) {
        if (block.name === 'get_spxw_trade_plan') {
          try {
            const maxResults = Math.max(1, Math.min(2, Number(block.input?.maxResults) || 2));
            const [scan, trigger] = await Promise.all([
              scanSpxwOpportunitiesV3({ maxResults }),
              buildSpxwTriggerPlan({ maxResults }),
            ]);
            const output = {
              source: 'Fahd SPXW engines',
              scan,
              trigger,
              strictRules: {
                useExactContractSymbol: true,
                useRealSpxPrice: true,
                forbidApproximationFromSpy: true,
                forbidInventedStrikeOrExpiration: true,
              },
            };
            collectedToolResults.push({ name: 'get_spxw_trade_plan', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = { error: e?.message || 'ظپط´ظ„ طھط´ط؛ظٹظ„ ظ…ط­ط±ظƒط§طھ SPXW' };
            collectedToolResults.push({ name: 'get_spxw_trade_plan', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_technical_indicators') {
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
        } else if (block.name === 'get_market_decision') {
          try {
            const output = await getMarketDecision(block.input?.timeframe || '15min');
            collectedToolResults.push({ name: 'get_market_decision', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = { error: e.message || 'ظپط´ظ„ طھط´ط؛ظٹظ„ ظ…ط­ط±ظƒ ظ‚ط±ط§ط± ط§ظ„ط³ظˆظ‚' };
            collectedToolResults.push({ name: 'get_market_decision', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_stock_decision') {
          try {
            const output = await getStockDecision(
              block.input.symbol,
              block.input.timeframe || '15min'
            );

            collectedToolResults.push({
              name: 'get_stock_decision',
              input: block.input,
              output,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = {
              error: e.message || 'ظپط´ظ„ طھط´ط؛ظٹظ„ ظ…ط­ط±ظƒ ط§طھط¬ط§ظ‡ ط§ظ„ط³ظ‡ظ…',
            };

            collectedToolResults.push({
              name: 'get_stock_decision',
              input: block.input,
              output,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_account') {
          try {
            const output = await getAccountBalance();
            collectedToolResults.push({ name: 'get_account', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = { error: e.message || 'ظپط´ظ„ ط¬ظ„ط¨ ط¨ظٹط§ظ†ط§طھ ط­ط³ط§ط¨ Tradier' };
            collectedToolResults.push({ name: 'get_account', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_positions') {
          try {
            const output = await getPositions();
            collectedToolResults.push({ name: 'get_positions', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = { error: e.message || 'ظپط´ظ„ ط¬ظ„ط¨ ظ…ط±ط§ظƒط² Tradier' };
            collectedToolResults.push({ name: 'get_positions', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_tradier_quote') {
          try {
            const rawQuote = await getTradierQuote(block.input.symbol);
            const output = enrichTradierQuoteFreshness(rawQuote);
            collectedToolResults.push({ name: 'get_tradier_quote', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = { error: e.message || 'ظپط´ظ„ ط¬ظ„ط¨ ط§ظ„ط³ط¹ط± ظ…ظ† Tradier' };
            collectedToolResults.push({ name: 'get_tradier_quote', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
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
            const output = { error: e.message || 'ظپط´ظ„ ط¬ظ„ط¨ طھظˆط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚' };
            collectedToolResults.push({ name: 'get_options_expirations', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'get_volume_profile') {
          const output = await getPreviousDayVolumeProfile(block.input.symbol);
          collectedToolResults.push({ name: 'get_volume_profile', input: block.input, output });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output),
            is_error: !!output.error,
          });
        } else if (block.name === 'get_recent_tv_signals') {
          try {
            const requestedLimit = Number(block.input?.limit);
            const limit = Number.isFinite(requestedLimit)
              ? Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
              : 10;
            const symbol =
              typeof block.input?.symbol === 'string'
                ? block.input.symbol.trim().toUpperCase()
                : '';

            if (symbol && !/^[A-Z0-9][A-Z0-9.:-]{0,31}$/.test(symbol)) {
              throw new Error('طµظٹط؛ط© ط±ظ…ط² ط§ظ„ط³ظ‡ظ… ط؛ظٹط± طµط­ظٹط­ط©');
            }

            let query = supabase
              .from('tradingview_signals')
              .select('symbol, signal_type, price, timeframe, created_at')
              .order('created_at', { ascending: false })
              .limit(limit);
            if (symbol) {
              query = query.eq('symbol', symbol);
            }
            const { data, error } = await query;
            const output = error ? { error: error.message } : { signals: data };
            collectedToolResults.push({ name: 'get_recent_tv_signals', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: !!error,
            });
          } catch (e: any) {
            const output = { error: e.message || 'ظپط´ظ„ ط¬ظ„ط¨ ط¥ط´ط§ط±ط§طھ TradingView' };
            collectedToolResults.push({ name: 'get_recent_tv_signals', input: block.input, output });
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
            const output = { error: e.message || 'ظپط´ظ„ ط¬ظ„ط¨ ط³ظ„ط³ظ„ط© ط§ظ„ط®ظٹط§ط±ط§طھ' };
            collectedToolResults.push({ name: 'get_options_chain', input: block.input, output });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
              is_error: true,
            });
          }
        } else if (block.name === 'analyze_trade') {
          try {
            const input = block.input as TradeEngineInput;

            if (
              !input ||
              !input.market ||
              !input.market.spy ||
              !input.market.qqq ||
              !input.stock ||
              !input.option ||
              !input.trigger
            ) {
              throw new Error(
                'ط¨ظٹط§ظ†ط§طھ ط§ظ„ط³ظˆظ‚ ط£ظˆ ط§ظ„ط£طµظ„ ط£ظˆ ط§ظ„ط¹ظ‚ط¯ ط£ظˆ ط§ظ„طھظپط¹ظٹظ„ ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©'
              );
            }

            if (
              typeof input.market.spy.price !== 'number' ||
              !Number.isFinite(input.market.spy.price) ||
              typeof input.market.qqq.price !== 'number' ||
              !Number.isFinite(input.market.qqq.price)
            ) {
              throw new Error('ط³ط¹ط± SPY ظˆط³ط¹ط± QQQ ظ…ط·ظ„ظˆط¨ط§ظ† ظˆظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ†ط§ ط±ظ‚ظ…ظٹظ† طµط­ظٹط­ظٹظ†');
            }

            if (
              typeof input.stock.symbol !== 'string' ||
              input.stock.symbol.trim().length === 0 ||
              typeof input.stock.price !== 'number' ||
              !Number.isFinite(input.stock.price)
            ) {
              throw new Error('ط±ظ…ط² ط§ظ„ط£طµظ„ ظˆط³ط¹ط±ظ‡ ط§ظ„ط­ط§ظ„ظٹ ظ…ط·ظ„ظˆط¨ط§ظ†');
            }

            if (
              typeof input.option.symbol !== 'string' ||
              input.option.symbol.trim().length === 0 ||
              typeof input.option.strike !== 'number' ||
              !Number.isFinite(input.option.strike) ||
              typeof input.option.underlyingPrice !== 'number' ||
              !Number.isFinite(input.option.underlyingPrice) ||
              typeof input.option.daysToExpiration !== 'number' ||
              !Number.isFinite(input.option.daysToExpiration)
            ) {
              throw new Error('ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ‚ط¯ ط§ظ„ط£ط³ط§ط³ظٹط© ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©');
            }

            if (
              input.option.optionType !== 'CALL' &&
              input.option.optionType !== 'PUT'
            ) {
              throw new Error('ظ†ظˆط¹ ط§ظ„ط¹ظ‚ط¯ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† CALL ط£ظˆ PUT');
            }

            if (
              input.trigger.direction !== 'CALL' &&
              input.trigger.direction !== 'PUT' &&
              input.trigger.direction !== 'NEUTRAL'
            ) {
              throw new Error(
                'ط§طھط¬ط§ظ‡ ط§ظ„طھظپط¹ظٹظ„ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† CALL ط£ظˆ PUT ط£ظˆ NEUTRAL'
              );
            }

            if (
              typeof input.trigger.candleClose !== 'number' ||
              !Number.isFinite(input.trigger.candleClose)
            ) {
              throw new Error('ط¥ط؛ظ„ط§ظ‚ ط´ظ…ط¹ط© ط§ظ„طھظپط¹ظٹظ„ ظ…ط·ظ„ظˆط¨');
            }

            const normalizedInput: TradeEngineInput = {
              ...input,
              stock: {
                ...input.stock,
                symbol: input.stock.symbol.trim().toUpperCase(),
              },
              option: {
                ...input.option,
                symbol: input.option.symbol.trim().toUpperCase(),
              },
            };

            const output = runTradeEngine(normalizedInput);

            collectedToolResults.push({
              name: 'analyze_trade',
              input: normalizedInput,
              output,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(output),
            });
          } catch (e: any) {
            const output = {
              error: e?.message || 'ظپط´ظ„ طھط´ط؛ظٹظ„ ظ…ط­ط±ظƒ طھظ‚ظٹظٹظ… ط§ظ„طµظپظ‚ط©',
            };

            collectedToolResults.push({
              name: 'analyze_trade',
              input: block.input,
              output,
            });

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
            content: JSON.stringify({ error: 'ط£ط¯ط§ط© ط؛ظٹط± ظ…ط¹ط±ظˆظپط©' }),
            is_error: true,
          });
        }
      }
      workingMessages.push({ role: 'user', content: toolResults });

      // ظ„ظˆ ظˆطµظ„ظ†ط§ ط¢ط®ط± ط¬ظˆظ„ط© ظˆظ…ط§ ط²ط§ظ„ ظپظٹظ‡ tool_useطŒ ط®ط° ط£ظٹ ظ†طµ ظ…طھظˆظپط± ظƒط­ظ„ ط§ط­طھظٹط§ط·ظٹ
      if (round === maxRounds - 1) {
        assistantText = textBlocks || 'ظ†ظپظ‘ط°طھ ط§ظ„ط·ظ„ط¨طŒ ط¨ط³ ظˆط§ط¬ظ‡طھ طµط¹ظˆط¨ط© ط£ظ„ط®طµظ‡ ط¨ظˆط¶ظˆط­. ط¬ط±ط¨ طھط³ط£ظ„ ظ…ط±ط© ط«ط§ظ†ظٹط©.';
      }
    }

    await supabase.from('fahd_conversations').insert([
      { role: 'user', content: message },
      { role: 'assistant', content: assistantText },
    ]);

    // ط§ظ„ط­ظپط¸ ط§ظ„طھظ„ظ‚ط§ط¦ظٹ ظ„ظ„ط°ط§ظƒط±ط© ط·ظˆظٹظ„ط© ط§ظ„ظ…ط¯ظ‰ - ط¨ط³ ظ„ظˆ ط§ظ„ظپظ„طھط± ط§ظ„ط³ط±ظٹط¹ ط§ط´طھط¨ظ‡ ظپظٹظ‡ط§طŒ
    // ط¹ط´ط§ظ† ظ†طھط¬ظ†ط¨ ط§ط³طھط¯ط¹ط§ط، Claude ط¥ط¶ط§ظپظٹ ط¹ظ„ظ‰ ظƒظ„ ط±ط³ط§ظ„ط© ط¹ط§ط¯ظٹط©
    if (mightContainSaveworthyInfo(message)) {
      await autoSaveMemory(message, assistantText);
    }

    return NextResponse.json({ reply: assistantText, toolResults: collectedToolResults });
  } catch (error) {
    console.error('Fahd chat route error:', error);
    return NextResponse.json({ error: 'ط­ط¯ط« ط®ط·ط£ ط؛ظٹط± ظ…طھظˆظ‚ط¹' }, { status: 500 });
  }
}

