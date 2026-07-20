// ============================================
// تكامل Tradier
// يدعم Production وSandbox حسب متغيرات Vercel
// ============================================

const TRADIER_TOKEN =
  process.env.TRADIER_TOKEN ||
  process.env.TRADIER_PRODUCTION_TOKEN ||
  process.env.TRADIER_SANDBOX_TOKEN;

const TRADIER_BASE = (
  process.env.TRADIER_BASE_URL || 'https://api.tradier.com/v1'
).replace(/\/+$/, '');

const TRADIER_ACCOUNT_ID = process.env.TRADIER_ACCOUNT_ID;

const IS_SANDBOX = TRADIER_BASE.includes('sandbox.tradier.com');

function ensureTradierConfigured() {
  if (!TRADIER_TOKEN) {
    throw new Error(
      'مفتاح Tradier غير موجود. أضف TRADIER_TOKEN في Environment Variables داخل Vercel.'
    );
  }
}

async function tradierGet(path: string) {
  ensureTradierConfigured();

  const response = await fetch(`${TRADIER_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${TRADIER_TOKEN}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const responseText = await response.text();

  let data: any = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = responseText;
  }

  if (!response.ok) {
    const apiMessage =
      data?.errors?.error ||
      data?.error ||
      data?.message ||
      responseText ||
      'Unknown Tradier error';

    throw new Error(
      `Tradier API error ${response.status}: ${
        typeof apiMessage === 'string'
          ? apiMessage
          : JSON.stringify(apiMessage)
      }`
    );
  }

  return data;
}

// ============================================
// الأنواع
// ============================================

export interface TradierQuote {
  symbol: string;
  description?: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change: number | null;
  change_percentage: number | null;
  volume: number | null;
  average_volume: number | null;
  trade_date?: number | null;
  type?: string;
  exchange?: string;
}

export interface OptionContract {
  symbol: string;
  strike: number;
  option_type: 'call' | 'put';
  expiration_date: string;
  bid: number;
  ask: number;
  last: number | null;
  volume: number;
  open_interest: number;
  greeks?: {
    delta?: number;
    theta?: number;
    gamma?: number;
    vega?: number;
    rho?: number;
    phi?: number;
    bid_iv?: number;
    mid_iv?: number;
    ask_iv?: number;
    smv_vol?: number;
  };
  spread_pct: number | null;
  liquidity_quality: 'جيد' | 'متوسط' | 'ضعيف - احذر';
  liquidity_reason: string;
}

export interface TradierPosition {
  id?: number;
  symbol: string;
  quantity: number;
  cost_basis: number;
  date_acquired?: string;
}

export interface TradierAccountSummary {
  accountId: string;
  accountType?: string;
  optionLevel?: number;
  status?: string;
  totalEquity: number | null;
  totalCash: number | null;
  stockBuyingPower: number | null;
  optionBuyingPower: number | null;
  openProfitLoss: number | null;
  closeProfitLoss: number | null;
  pendingCash: number | null;
  raw: any;
}

// ============================================
// تقييم سيولة العقود
// ============================================

const SPREAD_WIDE_THRESHOLD_PCT = 10;
const OI_LOW_THRESHOLD = 100;
const VOLUME_LOW_THRESHOLD = 10;

function numberOrZero(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function evaluateLiquidity(
  bid: number,
  ask: number,
  openInterest: number,
  volume: number
) {
  const mid = (bid + ask) / 2;

  const spreadPct =
    mid > 0 && ask >= bid ? ((ask - bid) / mid) * 100 : null;

  const reasons: string[] = [];

  let quality: 'جيد' | 'متوسط' | 'ضعيف - احذر' = 'جيد';

  const invalidPrices = bid <= 0 || ask <= 0 || ask < bid;

  const wideSpread =
    spreadPct !== null && spreadPct > SPREAD_WIDE_THRESHOLD_PCT;

  const lowOpenInterest = openInterest < OI_LOW_THRESHOLD;
  const lowVolume = volume < VOLUME_LOW_THRESHOLD;

  if (invalidPrices) {
    reasons.push('أسعار Bid/Ask غير مكتملة');
  }

  if (wideSpread) {
    reasons.push(`سبريد واسع (${spreadPct!.toFixed(1)}%)`);
  }

  if (lowOpenInterest) {
    reasons.push(`Open Interest ضعيف (${openInterest})`);
  }

  if (lowVolume) {
    reasons.push(`حجم التداول ضعيف اليوم (${volume})`);
  }

  const flagsCount = [
    invalidPrices,
    wideSpread,
    lowOpenInterest,
    lowVolume,
  ].filter(Boolean).length;

  if (invalidPrices || flagsCount >= 2) {
    quality = 'ضعيف - احذر';
  } else if (flagsCount === 1) {
    quality = 'متوسط';
  }

  return {
    spread_pct: spreadPct,
    liquidity_quality: quality,
    liquidity_reason:
      reasons.length > 0 ? reasons.join(' / ') : 'سيولة طبيعية',
  };
}

function liquidityRank(
  quality: 'جيد' | 'متوسط' | 'ضعيف - احذر'
): number {
  if (quality === 'جيد') return 0;
  if (quality === 'متوسط') return 1;
  return 2;
}

// ============================================
// تحديد رقم الحساب
// ============================================

export async function getTradierProfile() {
  const data = await tradierGet('/user/profile');

  const profile = data?.profile;

  if (!profile) {
    throw new Error('Tradier لم يرجع بيانات الملف الشخصي.');
  }

  return profile;
}

export async function resolveTradierAccountId(): Promise<string> {
  if (TRADIER_ACCOUNT_ID?.trim()) {
    return TRADIER_ACCOUNT_ID.trim();
  }

  const profile = await getTradierProfile();

  const accounts = profile?.account;
  const accountList = Array.isArray(accounts)
    ? accounts
    : accounts
      ? [accounts]
      : [];

  const firstAccount = accountList[0];

  const accountId =
    firstAccount?.account_number ||
    firstAccount?.account_id ||
    firstAccount?.id;

  if (!accountId) {
    throw new Error(
      'تعذر معرفة رقم حساب Tradier. أضف TRADIER_ACCOUNT_ID في Vercel.'
    );
  }

  return String(accountId);
}

// ============================================
// أسعار السوق
// ============================================

export async function getTradierQuote(
  symbol: string
): Promise<TradierQuote> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!/^[A-Z0-9.:-]{1,32}$/.test(normalizedSymbol)) {
    throw new Error('صيغة رمز السهم غير صحيحة.');
  }

  const data = await tradierGet(
    `/markets/quotes?symbols=${encodeURIComponent(
      normalizedSymbol
    )}&greeks=false`
  );

  const rawQuote = data?.quotes?.quote;
  const quote = Array.isArray(rawQuote) ? rawQuote[0] : rawQuote;

  if (!quote) {
    throw new Error(`لم يتم العثور على سعر ${normalizedSymbol}.`);
  }

  return {
    symbol: quote.symbol || normalizedSymbol,
    description: quote.description,
    last: nullableNumber(quote.last),
    bid: nullableNumber(quote.bid),
    ask: nullableNumber(quote.ask),
    open: nullableNumber(quote.open),
    high: nullableNumber(quote.high),
    low: nullableNumber(quote.low),
    close: nullableNumber(quote.close),
    change: nullableNumber(quote.change),
    change_percentage: nullableNumber(quote.change_percentage),
    volume: nullableNumber(quote.volume),
    average_volume: nullableNumber(quote.average_volume),
    trade_date: nullableNumber(quote.trade_date),
    type: quote.type,
    exchange: quote.exch || quote.exchange,
  };
}

async function getUnderlyingSpotPrice(
  symbol: string
): Promise<number | null> {
  try {
    const quote = await getTradierQuote(symbol);
    return quote.last ?? quote.close;
  } catch (error) {
    console.error('Tradier spot price error:', error);
    return null;
  }
}

// ============================================
// بيانات الحساب
// ============================================

export async function getAccountBalance(): Promise<TradierAccountSummary> {
  const accountId = await resolveTradierAccountId();

  const data = await tradierGet(
    `/accounts/${encodeURIComponent(accountId)}/balances`
  );

  const balances = data?.balances;

  if (!balances) {
    throw new Error('Tradier لم يرجع بيانات رصيد الحساب.');
  }

  const accountType =
    balances.account_type ||
    balances.type ||
    balances.classification;

  const cashDetails = balances.cash || {};
  const marginDetails = balances.margin || {};
  const pdtDetails = balances.pdt || {};

  return {
    accountId,
    accountType,
    optionLevel: nullableNumber(balances.option_level) ?? undefined,
    status: balances.status,
    totalEquity: nullableNumber(balances.total_equity),
    totalCash:
      nullableNumber(balances.total_cash) ??
      nullableNumber(cashDetails.cash_available),
    stockBuyingPower:
      nullableNumber(balances.stock_buying_power) ??
      nullableNumber(marginDetails.stock_buying_power) ??
      nullableNumber(pdtDetails.stock_buying_power),
    optionBuyingPower:
      nullableNumber(balances.option_buying_power) ??
      nullableNumber(cashDetails.option_buying_power) ??
      nullableNumber(marginDetails.option_buying_power) ??
      nullableNumber(pdtDetails.option_buying_power),
    openProfitLoss: nullableNumber(balances.open_pl),
    closeProfitLoss: nullableNumber(balances.close_pl),
    pendingCash: nullableNumber(balances.pending_cash),
    raw: balances,
  };
}

export async function getPositions(): Promise<{
  accountId: string;
  positions: TradierPosition[];
  count: number;
}> {
  const accountId = await resolveTradierAccountId();

  const data = await tradierGet(
    `/accounts/${encodeURIComponent(accountId)}/positions`
  );

  const rawPositions = data?.positions?.position;

  if (!rawPositions) {
    return {
      accountId,
      positions: [],
      count: 0,
    };
  }

  const positionList = Array.isArray(rawPositions)
    ? rawPositions
    : [rawPositions];

  const positions: TradierPosition[] = positionList.map(
    (position: any) => ({
      id: nullableNumber(position.id) ?? undefined,
      symbol: String(position.symbol || ''),
      quantity: numberOrZero(position.quantity),
      cost_basis: numberOrZero(position.cost_basis),
      date_acquired: position.date_acquired,
    })
  );

  return {
    accountId,
    positions,
    count: positions.length,
  };
}

// ============================================
// خيارات: تواريخ الاستحقاق
// ============================================

export async function getOptionsExpirations(
  symbol: string
): Promise<string[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  const data = await tradierGet(
    `/markets/options/expirations?symbol=${encodeURIComponent(
      normalizedSymbol
    )}&includeAllRoots=true&strikes=false`
  );

  const dates = data?.expirations?.date;

  if (!dates) {
    return [];
  }

  return Array.isArray(dates) ? dates : [dates];
}

// ============================================
// خيارات: Option Chain
// ============================================

const MAX_RETURNED_CONTRACTS = 12;

export async function getOptionsChain(
  symbol: string,
  expiration: string
): Promise<{
  symbol: string;
  expiration: string;
  spotPrice: number | null;
  contracts: OptionContract[];
  totalContractsAvailable: number;
  environment: 'production' | 'sandbox';
  dataDelayNote: string;
}> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) {
    throw new Error(
      'تاريخ الاستحقاق يجب أن يكون بصيغة YYYY-MM-DD.'
    );
  }

  const [data, spotPrice] = await Promise.all([
    tradierGet(
      `/markets/options/chains?symbol=${encodeURIComponent(
        normalizedSymbol
      )}&expiration=${encodeURIComponent(expiration)}&greeks=true`
    ),
    getUnderlyingSpotPrice(normalizedSymbol),
  ]);

  const rawOptions = data?.options?.option;

  const optionList = rawOptions
    ? Array.isArray(rawOptions)
      ? rawOptions
      : [rawOptions]
    : [];

  let contracts: OptionContract[] = optionList.map((option: any) => {
    const bid = numberOrZero(option.bid);
    const ask = numberOrZero(option.ask);
    const openInterest = numberOrZero(option.open_interest);
    const volume = numberOrZero(option.volume);

    const liquidity = evaluateLiquidity(
      bid,
      ask,
      openInterest,
      volume
    );

    return {
      symbol: String(option.symbol || ''),
      strike: numberOrZero(option.strike),
      option_type: option.option_type,
      expiration_date: option.expiration_date,
      bid,
      ask,
      last: nullableNumber(option.last),
      volume,
      open_interest: openInterest,
      greeks: option.greeks
        ? {
            delta: nullableNumber(option.greeks.delta) ?? undefined,
            theta: nullableNumber(option.greeks.theta) ?? undefined,
            gamma: nullableNumber(option.greeks.gamma) ?? undefined,
            vega: nullableNumber(option.greeks.vega) ?? undefined,
            rho: nullableNumber(option.greeks.rho) ?? undefined,
            phi: nullableNumber(option.greeks.phi) ?? undefined,
            bid_iv: nullableNumber(option.greeks.bid_iv) ?? undefined,
            mid_iv: nullableNumber(option.greeks.mid_iv) ?? undefined,
            ask_iv: nullableNumber(option.greeks.ask_iv) ?? undefined,
            smv_vol: nullableNumber(option.greeks.smv_vol) ?? undefined,
          }
        : undefined,
      ...liquidity,
    };
  });

  const totalContractsAvailable = contracts.length;

  if (spotPrice !== null) {
    contracts = contracts
      .map((contract) => ({
        contract,
        distance: Math.abs(contract.strike - spotPrice),
      }))
      .sort((first, second) => {
        if (first.distance !== second.distance) {
          return first.distance - second.distance;
        }

        const liquidityDifference =
          liquidityRank(first.contract.liquidity_quality) -
          liquidityRank(second.contract.liquidity_quality);

        if (liquidityDifference !== 0) {
          return liquidityDifference;
        }

        return (
          (first.contract.spread_pct ?? 999) -
          (second.contract.spread_pct ?? 999)
        );
      })
      .map((item) => item.contract);
  } else {
    contracts = contracts.sort(
      (first, second) =>
        liquidityRank(first.liquidity_quality) -
        liquidityRank(second.liquidity_quality)
    );
  }

  contracts = contracts.slice(0, MAX_RETURNED_CONTRACTS);

  return {
    symbol: normalizedSymbol,
    expiration,
    spotPrice,
    contracts,
    totalContractsAvailable,
    environment: IS_SANDBOX ? 'sandbox' : 'production',
    dataDelayNote: IS_SANDBOX
      ? 'بيانات Sandbox متأخرة ومخصصة للتجربة والتداول الورقي.'
      : 'الاتصال ببيئة Production. بيانات السوق تعتمد على صلاحيات واشتراك حساب Tradier.',
  };
}
