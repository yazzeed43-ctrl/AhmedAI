export type TelegramUpdate = {
  update_id: number;
  message?: any;
  edited_message?: any;
  channel_post?: any;
  edited_channel_post?: any;
};

export type SocialContentType =
  | 'SIGNAL'
  | 'NEWS'
  | 'EARNINGS'
  | 'BREAKING'
  | 'WHALE'
  | 'FED';

export type MarketImpact =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH';

export type SignalType =
  | 'CALL'
  | 'PUT'
  | 'BUY'
  | 'SELL'
  | 'WATCH'
  | null;

export function getTelegramMessage(update: TelegramUpdate) {
  return (
    update.channel_post ??
    update.edited_channel_post ??
    update.message ??
    update.edited_message ??
    null
  );
}

export function getTelegramText(message: any): string {
  return String(message?.text ?? message?.caption ?? '').trim();
}

export function getTelegramSource(message: any) {
  const source = message?.sender_chat ?? message?.chat ?? {};
  const fallback = [source.first_name, source.last_name]
    .filter(Boolean)
    .join(' ');

  return {
    sourceId: String(source.id ?? ''),
    sourceName:
      source.title ??
      source.username ??
      fallback ??
      String(source.id ?? ''),
  };
}

const aliases: Record<string, string> = {
  SPXW: 'SPX',
  'SPX.X': 'SPX',
  GSPC: 'SPX',
  'ES1!': 'ES',
  'NQ1!': 'NQ',
};

const companyToSymbols: Record<string, string[]> = {
  ALPHABET: ['GOOG', 'GOOGL'],
  GOOGLE: ['GOOG', 'GOOGL'],
  TESLA: ['TSLA'],
  IBM: ['IBM'],
  APPLE: ['AAPL'],
  AMAZON: ['AMZN'],
  MICROSOFT: ['MSFT'],
  NVIDIA: ['NVDA'],
  META: ['META'],
  FACEBOOK: ['META'],
  SERVICENOW: ['NOW'],
  'TEXAS INSTRUMENTS': ['TXN'],
  NETFLIX: ['NFLX'],
  AMD: ['AMD'],
  'ADVANCED MICRO DEVICES': ['AMD'],
  INTEL: ['INTC'],
  BROADCOM: ['AVGO'],
  QUALCOMM: ['QCOM'],
  PALANTIR: ['PLTR'],
  COINBASE: ['COIN'],
  ROBINHOOD: ['HOOD'],
  UBER: ['UBER'],
  AIRBNB: ['ABNB'],
  BOEING: ['BA'],
  JPMORGAN: ['JPM'],
  'JP MORGAN': ['JPM'],
  'BANK OF AMERICA': ['BAC'],
  GOLDMAN: ['GS'],
  WALMART: ['WMT'],
  COSTCO: ['COST'],
  DISNEY: ['DIS'],
  NIKE: ['NKE'],
  SALESFORCE: ['CRM'],
  ORACLE: ['ORCL'],
  ADOBE: ['ADBE'],
  SHOPIFY: ['SHOP'],
  EQUINOR: ['EQNR'],
  'EQUINOR ASA': ['EQNR'],
};

const ignored = new Set([
  'AFTER',
  'ALERT',
  'ALL',
  'BEFORE',
  'BREAKING',
  'BUY',
  'CALL',
  'CEO',
  'CLOSE',
  'CLOSED',
  'CPI',
  'DAY',
  'EMA',
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
  'NEW',
  'NEWS',
  'NFP',
  'NOW',
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
  'TODAY',
  'USD',
  'USA',
  'VWAP',
  'WAIT',
  'WATCH',
  'WHALE',
]);

// ملاحظة: "NIKE" غير موجودة هنا عمدًا — استخراجها يتم فقط عبر
// companyToSymbols حتى تتحول دائمًا للرمز الصحيح "NKE" وليس "NIKE".
const plainTickerAllowlist = new Set([
  'AAPL',
  'ABNB',
  'ADBE',
  'AMD',
  'AMZN',
  'AVGO',
  'BA',
  'BAC',
  'COIN',
  'COST',
  'CRM',
  'DIS',
  'EQNR',
  'ES',
  'GOOG',
  'GOOGL',
  'GS',
  'HOOD',
  'IBM',
  'INTC',
  'JPM',
  'META',
  'MSFT',
  'NFLX',
  'NKE',
  'NQ',
  'NVDA',
  'ORCL',
  'PLTR',
  'QCOM',
  'QQQ',
  'SHOP',
  'SPX',
  'SPY',
  'TSLA',
  'TXN',
  'UBER',
  'WMT',
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
  return [
    ...new Set(
      symbols
        .map(normalizeSymbol)
        .filter(isValidSymbol)
    ),
  ];
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCompanySymbols(text: string): string[] {
  const upper = text.toUpperCase();
  const matched: string[] = [];

  for (const [company, symbols] of Object.entries(
    companyToSymbols
  )) {
    // حدود كلمة كاملة (\b) حتى لا تُطابق "META" داخل "METADATA"
    // أو "METAVERSE" أو أي substring غير مقصود.
    const pattern = new RegExp(
      `\\b${escapeRegExp(company)}\\b`
    );

    if (pattern.test(upper)) {
      matched.push(...symbols);
    }
  }

  return uniqueSymbols(matched);
}

function extractTaggedSymbols(text: string): string[] {
  return uniqueSymbols(
    [
      ...text.matchAll(
        /[$#]([A-Za-z][A-Za-z0-9.]{0,9})\b/g
      ),
    ].map((match) => match[1])
  );
}

function extractAllowedPlainSymbols(text: string): string[] {
  const tokens =
    text
      .toUpperCase()
      .match(/\b[A-Z][A-Z0-9.]{1,9}\b/g) ??
    [];

  return uniqueSymbols(
    tokens.filter((token) =>
      plainTickerAllowlist.has(
        normalizeSymbol(token)
      )
    )
  );
}

export function extractSymbols(text: string): string[] {
  const explicitField =
    extractExplicitSymbolField(text);

  if (explicitField.length > 0) {
    return explicitField;
  }

  return uniqueSymbols([
    ...extractTaggedSymbols(text),
    ...extractCompanySymbols(text),
    ...extractAllowedPlainSymbols(text),
  ]);
}

export function extractSymbol(
  text: string
): string | null {
  return extractSymbols(text)[0] ?? null;
}

export function detectContentTypes(
  text: string
): SocialContentType[] {
  const upper = text.toUpperCase();
  const types: SocialContentType[] = [];

  const isEarnings =
    upper.includes('EARNINGS') ||
    upper.includes('EARNINGS REPORT') ||
    upper.includes('REPORTS EARNINGS') ||
    upper.includes('AFTER CLOSE') ||
    upper.includes('AFTER THE CLOSE') ||
    upper.includes('AFTER MARKET') ||
    upper.includes('BEFORE OPEN') ||
    upper.includes('BEFORE THE OPEN') ||
    upper.includes('قبل الافتتاح') ||
    upper.includes('بعد الإغلاق') ||
    upper.includes('نتائج') ||
    upper.includes('أرباح');

  const isBreaking =
    upper.includes('BREAKING') ||
    upper.includes('URGENT') ||
    upper.includes('عاجل') ||
    text.includes('🚨');

  const isFed =
    upper.includes('FED') ||
    upper.includes('FOMC') ||
    upper.includes('POWELL') ||
    upper.includes('FEDERAL RESERVE') ||
    upper.includes('الفيدرالي') ||
    upper.includes('باول');

  const isWhale =
    upper.includes('WHALE') ||
    upper.includes('UNUSUAL WHALES') ||
    upper.includes('UNUSUAL OPTIONS') ||
    upper.includes('OPTIONS FLOW') ||
    upper.includes('BLOCK TRADE') ||
    upper.includes('حوت') ||
    upper.includes('تدفقات غير اعتيادية');

  const isSignal =
    upper.includes('CALL') ||
    upper.includes('PUT') ||
    upper.includes('BUY') ||
    upper.includes('SELL') ||
    upper.includes('LONG') ||
    upper.includes('SHORT') ||
    upper.includes('ENTRY') ||
    upper.includes('TARGET') ||
    upper.includes('STOP') ||
    upper.includes('شراء') ||
    upper.includes('بيع') ||
    upper.includes('دخول') ||
    upper.includes('هدف') ||
    upper.includes('وقف');

  if (isEarnings) types.push('EARNINGS');
  if (isBreaking) types.push('BREAKING');
  if (isFed) types.push('FED');
  if (isWhale) types.push('WHALE');
  if (isSignal) types.push('SIGNAL');

  if (types.length === 0) {
    types.push('NEWS');
  }

  return [...new Set(types)];
}

export function detectPrimaryContentType(
  contentTypes: SocialContentType[]
): SocialContentType {
  const priority: SocialContentType[] = [
    'EARNINGS',
    'FED',
    'WHALE',
    'SIGNAL',
    'BREAKING',
    'NEWS',
  ];

  return (
    priority.find((type) =>
      contentTypes.includes(type)
    ) ?? 'NEWS'
  );
}

export function detectMarketImpact(
  text: string,
  contentTypes: SocialContentType[]
): MarketImpact {
  const upper = text.toUpperCase();

  if (
    contentTypes.includes('EARNINGS') ||
    contentTypes.includes('FED') ||
    contentTypes.includes('BREAKING') ||
    upper.includes('HIGH IMPACT') ||
    upper.includes('MAJOR') ||
    upper.includes('SURPRISE') ||
    upper.includes('GUIDANCE') ||
    upper.includes('RATE DECISION') ||
    upper.includes('CPI') ||
    upper.includes('PCE') ||
    upper.includes('NFP') ||
    upper.includes('GDP') ||
    upper.includes('مرتفع التأثير') ||
    upper.includes('التوجيهات') ||
    upper.includes('قرار الفائدة')
  ) {
    return 'HIGH';
  }

  if (
    contentTypes.includes('SIGNAL') ||
    contentTypes.includes('WHALE') ||
    upper.includes('MEDIUM IMPACT') ||
    upper.includes('UPGRADE') ||
    upper.includes('DOWNGRADE') ||
    upper.includes('PRICE TARGET') ||
    upper.includes('TARGET PRICE') ||
    upper.includes('رفع التوصية') ||
    upper.includes('خفض التوصية')
  ) {
    return 'MEDIUM';
  }

  return 'LOW';
}

export function parseTelegramSignal(text: string) {
  const upper = text.toUpperCase();

  const bullishWords = [
    'CALL',
    'BUY',
    'LONG',
    'BULLISH',
    'BREAKOUT',
    'BEAT',
    'RAISES GUIDANCE',
    'UPGRADE',
    'LIFTS TARGET PRICE',
    'RAISES TARGET PRICE',
    'اختراق',
    'شراء',
    'صعود',
    'كول',
    'أفضل من المتوقع',
    'رفع التوجيهات',
  ];

  const bearishWords = [
    'PUT',
    'SELL',
    'SHORT',
    'BEARISH',
    'BREAKDOWN',
    'MISS',
    'LOWERS GUIDANCE',
    'DOWNGRADE',
    'CUTS TARGET PRICE',
    'LOWERS TARGET PRICE',
    'كسر',
    'بيع',
    'هبوط',
    'بوت',
    'أقل من المتوقع',
    'خفض التوجيهات',
  ];

  const bullishHits = bullishWords.filter(
    (word) =>
      upper.includes(word.toUpperCase())
  ).length;

  const bearishHits = bearishWords.filter(
    (word) =>
      upper.includes(word.toUpperCase())
  ).length;

  let signalType: SignalType = null;

  if (
    upper.includes('CALL') ||
    upper.includes('كول')
  ) {
    signalType = 'CALL';
  } else if (
    upper.includes('PUT') ||
    upper.includes('بوت')
  ) {
    signalType = 'PUT';
  } else if (
    upper.includes('BUY') ||
    upper.includes('شراء')
  ) {
    signalType = 'BUY';
  } else if (
    upper.includes('SELL') ||
    upper.includes('بيع')
  ) {
    signalType = 'SELL';
  } else if (
    [
      'WATCH',
      'WAIT',
      'راقب',
      'انتظار',
    ].some((word) =>
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

  if (signalType) {
    confidence += 0.15;
  }

  if (
    Math.max(
      bullishHits,
      bearishHits
    ) >= 2
  ) {
    confidence += 0.15;
  }

  if (
    /\b(?:ENTRY|TARGET|TP|SL|STOP|دخول|هدف|وقف)\b/i.test(
      text
    )
  ) {
    confidence += 0.15;
  }

  if (
    /\b\d{2,5}(?:\.\d+)?\b/.test(text)
  ) {
    confidence += 0.1;
  }

  const symbols = extractSymbols(text);
  const contentTypes = detectContentTypes(text);
  const contentType =
    detectPrimaryContentType(contentTypes);
  const marketImpact =
    detectMarketImpact(text, contentTypes);

  return {
    symbol: symbols[0] ?? null,
    symbols,
    contentType,
    contentTypes,
    marketImpact,
    signalType,
    sentiment,
    confidence: Math.min(
      0.9,
      Number(confidence.toFixed(2))
    ),
  };
}