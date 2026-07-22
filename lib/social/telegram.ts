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

const aliases: Record<string, string> = {
  SPXW: 'SPX',
  'SPX.X': 'SPX',
  GSPC: 'SPX',
  'ES1!': 'ES',
  'NQ1!': 'NQ',
};

const ignored = new Set([
  'AFTER',
  'ALERT',
  'BEFORE',
  'BREAKING',
  'BUY',
  'CALL',
  'CEO',
  'CLOSE',
  'CLOSED',
  'ENTRY',
  'ETF',
  'EXIT',
  'FED',
  'FOMC',
  'GDP',
  'HOLD',
  'LONG',
  'LOSS',
  'MACD',
  'MARKET',
  'NEWS',
  'NFP',
  'OPEN',
  'OPENING',
  'PCE',
  'PPI',
  'PUT',
  'RSI',
  'SELL',
  'SHORT',
  'SMA',
  'STOP',
  'TARGET',
  'USD',
  'VWAP',
  'WAIT',
  'WATCH',
  'WHALE',
  'CPI',
  'EMA',
]);

function normalizeSymbol(raw: string): string {
  const clean = raw
    .trim()
    .replace(/^[$#]/, '')
    .replace(/[,:;]+$/, '')
    .toUpperCase();

  return aliases[clean] ?? clean;
}

function isValidSymbol(raw: string): boolean {
  const symbol = normalizeSymbol(raw);

  return (
    /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) &&
    !ignored.has(symbol)
  );
}

function uniqueSymbols(symbols: string[]): string[] {
  return [...new Set(
    symbols
      .map(normalizeSymbol)
      .filter(isValidSymbol)
  )];
}

function extractExplicitSymbolField(text: string): string[] {
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /^\s*symbols?\s*:\s*(.+)$/i
    );

    if (!match) continue;

    const values = match[1]
      .split(/[\s,|/]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    const symbols = uniqueSymbols(values);

    if (symbols.length > 0) {
      return symbols;
    }
  }

  return [];
}

export function extractSymbols(text: string): string[] {
  const explicitField = extractExplicitSymbolField(text);

  if (explicitField.length > 0) {
    return explicitField;
  }

  const tagged = uniqueSymbols(
    [...text.matchAll(/[$#]([A-Za-z][A-Za-z0-9.]{0,9})\b/g)]
      .map((match) => match[1])
  );

  if (tagged.length > 0) {
    return tagged;
  }

  const plainTokens = text
    .toUpperCase()
    .match(/\b[A-Z][A-Z0-9.]{1,9}\b/g) ?? [];

  return uniqueSymbols(plainTokens);
}

export function extractSymbol(text: string): string | null {
  return extractSymbols(text)[0] ?? null;
}

export function parseTelegramSignal(text: string) {
  const upper = text.toUpperCase();

  const bullishWords = [
    'CALL',
    'BUY',
    'LONG',
    'BULLISH',
    'BREAKOUT',
    'ط·آ§ط·آ®ط·ع¾ط·آ±ط·آ§ط¸â€ڑ',
    'ط·آ´ط·آ±ط·آ§ط·طŒ',
    'ط·آµط·آ¹ط¸ث†ط·آ¯',
    'ط¸ئ’ط¸ث†ط¸â€‍',
  ];

  const bearishWords = [
    'PUT',
    'SELL',
    'SHORT',
    'BEARISH',
    'BREAKDOWN',
    'ط¸ئ’ط·آ³ط·آ±',
    'ط·آ¨ط¸ظ¹ط·آ¹',
    'ط¸â€،ط·آ¨ط¸ث†ط·آ·',
    'ط·آ¨ط¸ث†ط·ع¾',
  ];

  const bullishHits = bullishWords.filter((word) =>
    upper.includes(word.toUpperCase())
  ).length;

  const bearishHits = bearishWords.filter((word) =>
    upper.includes(word.toUpperCase())
  ).length;

  let signalType: string | null = null;

  if (upper.includes('CALL') || upper.includes('ط¸ئ’ط¸ث†ط¸â€‍')) {
    signalType = 'CALL';
  } else if (upper.includes('PUT') || upper.includes('ط·آ¨ط¸ث†ط·ع¾')) {
    signalType = 'PUT';
  } else if (upper.includes('BUY') || upper.includes('ط·آ´ط·آ±ط·آ§ط·طŒ')) {
    signalType = 'BUY';
  } else if (upper.includes('SELL') || upper.includes('ط·آ¨ط¸ظ¹ط·آ¹')) {
    signalType = 'SELL';
  } else if (
    ['NEWS', 'BREAKING', 'ALERT', 'ط·آ®ط·آ¨ط·آ±', 'ط·آ¹ط·آ§ط·آ¬ط¸â€‍'].some((word) =>
      upper.includes(word.toUpperCase())
    )
  ) {
    signalType = 'NEWS';
  } else if (
    ['WATCH', 'WAIT', 'ط·آ±ط·آ§ط¸â€ڑط·آ¨', 'ط·آ§ط¸â€ ط·ع¾ط·آ¸ط·آ§ط·آ±'].some((word) =>
      upper.includes(word.toUpperCase())
    )
  ) {
    signalType = 'WATCH';
  }

  const sentiment =
    bullishHits > bearishHits
      ? 'bullish'
      : bearishHits > bullishHits
        ? 'bearish'
        : 'neutral';

  let confidence = 0.35;

  if (signalType) confidence += 0.15;
  if (Math.max(bullishHits, bearishHits) >= 2) confidence += 0.15;
  if (/\b(?:ENTRY|TARGET|TP|SL|STOP|ط·آ¯ط·آ®ط¸ث†ط¸â€‍|ط¸â€،ط·آ¯ط¸ظ¾|ط¸ث†ط¸â€ڑط¸ظ¾)\b/i.test(text)) {
    confidence += 0.15;
  }
  if (/\b\d{2,5}(?:\.\d+)?\b/.test(text)) {
    confidence += 0.1;
  }

  const symbols = extractSymbols(text);

  return {
    symbol: symbols[0] ?? null,
    symbols,
    signalType,
    sentiment,
    confidence: Math.min(0.9, Number(confidence.toFixed(2))),
  };
}
