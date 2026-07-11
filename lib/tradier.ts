// ============================================
// تكامل Tradier لبيانات الخيارات (Options Chain)
// حالياً: Sandbox (بيانات متأخرة 15 دقيقة - للتجربة والتقييم، مو لقرار دخول لحظي)
// لاحقاً: بدّل TRADIER_BASE و التوكن لـ Production لما تتأكد من أهلية حسابك
// ============================================

const TRADIER_TOKEN = process.env.TRADIER_SANDBOX_TOKEN!;
const TRADIER_BASE = 'https://sandbox.tradier.com/v1';
// عند الانتقال لـ Production، بدّل السطرين أعلاه إلى:
// const TRADIER_TOKEN = process.env.TRADIER_PRODUCTION_TOKEN!;
// const TRADIER_BASE = 'https://api.tradier.com/v1';

async function tradierGet(path: string) {
  const res = await fetch(`${TRADIER_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${TRADIER_TOKEN}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Tradier API error: ${res.status}`);
  }
  return res.json();
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
    mid_iv?: number;
  };
  // تقييمنا الإضافي لجودة السيولة
  spread_pct: number | null;
  liquidity_quality: 'جيد' | 'متوسط' | 'ضعيف - احذر';
  liquidity_reason: string;
}

// ============================================
// حدود تقييم السيولة (قابلة للتعديل حسب تفضيلك)
// ============================================
const SPREAD_WIDE_THRESHOLD_PCT = 10; // سبريد أوسع من 10% من السعر المتوسط = واسع
const OI_LOW_THRESHOLD = 100; // Open Interest أقل من هذا = ضعيف
const VOLUME_LOW_THRESHOLD = 10; // حجم تداول اليوم أقل من هذا = ضعيف

function evaluateLiquidity(bid: number, ask: number, oi: number, volume: number) {
  const mid = (bid + ask) / 2;
  const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : null;

  const reasons: string[] = [];
  let quality: 'جيد' | 'متوسط' | 'ضعيف - احذر' = 'جيد';

  const wideSpread = spreadPct !== null && spreadPct > SPREAD_WIDE_THRESHOLD_PCT;
  const lowOI = oi < OI_LOW_THRESHOLD;
  const lowVolume = volume < VOLUME_LOW_THRESHOLD;

  if (wideSpread) reasons.push(`سبريد واسع (${spreadPct!.toFixed(1)}%)`);
  if (lowOI) reasons.push(`Open Interest ضعيف (${oi})`);
  if (lowVolume) reasons.push(`حجم تداول ضعيف اليوم (${volume})`);

  const flagsCount = [wideSpread, lowOI, lowVolume].filter(Boolean).length;
  if (flagsCount >= 2) {
    quality = 'ضعيف - احذر';
  } else if (flagsCount === 1) {
    quality = 'متوسط';
  }

  return {
    spread_pct: spreadPct,
    liquidity_quality: quality,
    liquidity_reason: reasons.length > 0 ? reasons.join(' / ') : 'سيولة طبيعية',
  };
}

export async function getOptionsExpirations(symbol: string): Promise<string[]> {
  const data = await tradierGet(
    `/markets/options/expirations?symbol=${encodeURIComponent(symbol.toUpperCase())}&includeAllRoots=true&strikes=false`
  );
  const dates = data?.expirations?.date;
  if (!dates) return [];
  return Array.isArray(dates) ? dates : [dates];
}

export async function getOptionsChain(
  symbol: string,
  expiration: string
): Promise<{ symbol: string; expiration: string; contracts: OptionContract[]; dataDelayNote: string }> {
  const data = await tradierGet(
    `/markets/options/chains?symbol=${encodeURIComponent(symbol.toUpperCase())}&expiration=${expiration}&greeks=true`
  );
  const rawOptions = data?.options?.option;
  const list = rawOptions ? (Array.isArray(rawOptions) ? rawOptions : [rawOptions]) : [];

  const contracts: OptionContract[] = list.map((o: any) => {
    const liquidity = evaluateLiquidity(
      o.bid ?? 0,
      o.ask ?? 0,
      o.open_interest ?? 0,
      o.volume ?? 0
    );
    return {
      symbol: o.symbol,
      strike: o.strike,
      option_type: o.option_type,
      expiration_date: o.expiration_date,
      bid: o.bid,
      ask: o.ask,
      last: o.last ?? null,
      volume: o.volume ?? 0,
      open_interest: o.open_interest ?? 0,
      greeks: o.greeks
        ? {
            delta: o.greeks.delta,
            theta: o.greeks.theta,
            gamma: o.greeks.gamma,
            vega: o.greeks.vega,
            mid_iv: o.greeks.mid_iv,
          }
        : undefined,
      ...liquidity,
    };
  });

  return {
    symbol: symbol.toUpperCase(),
    expiration,
    contracts,
    dataDelayNote:
      'بيانات Sandbox متأخرة 15 دقيقة - للتقييم والتجربة فقط، مو لقرار دخول لحظي بالسوق.',
  };
}
