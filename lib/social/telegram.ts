export type TelegramUpdate = {
  update_id: number;
  message?: any;
  edited_message?: any;
  channel_post?: any;
  edited_channel_post?: any;
};

export function getTelegramMessage(update: TelegramUpdate) {
  return update.channel_post ?? update.edited_channel_post ?? update.message ?? update.edited_message ?? null;
}

export function getTelegramText(message: any): string {
  return String(message?.text ?? message?.caption ?? '').trim();
}

export function getTelegramSource(message: any) {
  const source = message?.sender_chat ?? message?.chat ?? {};
  const fallback = [source.first_name, source.last_name].filter(Boolean).join(' ');
  return {
    sourceId: String(source.id ?? ''),
    sourceName: source.title ?? source.username ?? fallback ?? String(source.id ?? ''),
  };
}

const aliases: Record<string, string> = { SPXW: 'SPX', 'SPX.X': 'SPX', GSPC: 'SPX', 'ES1!': 'ES', 'NQ1!': 'NQ' };
const ignored = new Set(['CALL','PUT','BUY','SELL','LONG','SHORT','STOP','LOSS','TARGET','ENTRY','EXIT','HOLD','WAIT','NEWS','USD','ETF','CEO','RSI','MACD','VWAP','EMA','SMA','FOMC','CPI','PPI','PCE','GDP','NFP']);

function normalizeSymbol(raw: string) {
  const clean = raw.replace(/^[$#]/, '').toUpperCase();
  return aliases[clean] ?? clean;
}

export function extractSymbol(text: string): string | null {
  const explicit = text.match(/[$#]([A-Za-z][A-Za-z0-9.]{0,9})\b/);
  if (explicit) return normalizeSymbol(explicit[1]);

  for (const token of text.toUpperCase().match(/\b[A-Z][A-Z0-9.]{1,9}\b/g) ?? []) {
    const symbol = normalizeSymbol(token);
    if (!ignored.has(symbol)) return symbol;
  }
  return null;
}

export function parseTelegramSignal(text: string) {
  const upper = text.toUpperCase();
  const bullishWords = ['CALL','BUY','LONG','BULLISH','BREAKOUT','اختراق','شراء','صعود','كول'];
  const bearishWords = ['PUT','SELL','SHORT','BEARISH','BREAKDOWN','كسر','بيع','هبوط','بوت'];
  const bullishHits = bullishWords.filter((w) => upper.includes(w.toUpperCase())).length;
  const bearishHits = bearishWords.filter((w) => upper.includes(w.toUpperCase())).length;

  let signalType: string | null = null;
  if (upper.includes('CALL') || upper.includes('كول')) signalType = 'CALL';
  else if (upper.includes('PUT') || upper.includes('بوت')) signalType = 'PUT';
  else if (upper.includes('BUY') || upper.includes('شراء')) signalType = 'BUY';
  else if (upper.includes('SELL') || upper.includes('بيع')) signalType = 'SELL';
  else if (['NEWS','BREAKING','ALERT','خبر','عاجل'].some((w) => upper.includes(w.toUpperCase()))) signalType = 'NEWS';
  else if (['WATCH','WAIT','راقب','انتظار'].some((w) => upper.includes(w.toUpperCase()))) signalType = 'WATCH';

  const sentiment = bullishHits > bearishHits ? 'bullish' : bearishHits > bullishHits ? 'bearish' : 'neutral';
  let confidence = 0.35;
  if (signalType) confidence += 0.15;
  if (Math.max(bullishHits, bearishHits) >= 2) confidence += 0.15;
  if (/\b(?:ENTRY|TARGET|TP|SL|STOP|دخول|هدف|وقف)\b/i.test(text)) confidence += 0.15;
  if (/\b\d{2,5}(?:\.\d+)?\b/.test(text)) confidence += 0.1;

  return {
    symbol: extractSymbol(text),
    signalType,
    sentiment,
    confidence: Math.min(0.9, Number(confidence.toFixed(2))),
  };
}
