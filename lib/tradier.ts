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

async function getUnderlyingSpotPrice(symbol: string): Promise<number | null> {
  try {
    const data = await tradierGet(`/markets/quotes?symbols=${encodeURIComponent(symbol.toUpperCase())}`);
    const q = data?.quotes?.quote;
    const quote = Array.isArray(q) ? q[0] : q;
    return quote?.last ?? quote?.close ?? null;
  } catch {
    return null;
  }
}

// ترتيب أولوية جودة السيولة، يُستخدم كمعيار ترتيب ثانوي
function liquidityRank(q: 'جيد' | 'متوسط' | 'ضعيف - احذر'): number {
  if (q === 'جيد') return 0;
  if (q === 'متوسط') return 1;
  return 2;
}

const MAX_RETURNED_CONTRACTS = 12; // نحد عدد العقود المرسلة للواجهة عشان الرد يبقى سريع وواضح

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
): Promise<{
  symbol: string;
  expiration: string;
  spotPrice: number | null;
  contracts: OptionContract[];
  totalContractsAvailable: number;
  dataDelayNote: string;
}> {
  const [data, spotPrice] = await Promise.all([
    tradierGet(`/markets/options/chains?symbol=${encodeURIComponent(symbol.toUpperCase())}&expiration=${expiration}&greeks=true`),
    getUnderlyingSpotPrice(symbol),
  ]);

  const rawOptions = data?.options?.option;
  const list = rawOptions ? (Array.isArray(rawOptions) ? rawOptions : [rawOptions]) : [];

  let contracts: OptionContract[] = list.map((o: any) => {
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

  const totalContractsAvailable = contracts.length;

  // الترتيب: الأقرب للسعر الحالي أول، وعند التساوي التقريبي تُفضّل جودة السيولة الأعلى
  if (spotPrice !== null) {
    contracts = contracts
      .map((c) => ({ c, distance: Math.abs(c.strike - spotPrice) }))
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        const liqDiff = liquidityRank(a.c.liquidity_quality) - liquidityRank(b.c.liquidity_quality);
        if (liqDiff !== 0) return liqDiff;
        return (a.c.spread_pct ?? 999) - (b.c.spread_pct ?? 999);
      })
      .map((x) => x.c);
  } else {
    // لو ما قدرنا نجيب السعر الحالي لأي سبب، نرتب بالسيولة كخطة بديلة
    contracts = contracts.sort((a, b) => liquidityRank(a.liquidity_quality) - liquidityRank(b.liquidity_quality));
  }

  contracts = contracts.slice(0, MAX_RETURNED_CONTRACTS);

  return {
    symbol: symbol.toUpperCase(),
    expiration,
    spotPrice,
    contracts,
    totalContractsAvailable,
    dataDelayNote:
      'بيانات Sandbox متأخرة 15 دقيقة - للتقييم والتجربة فقط، مو لقرار دخول لحظي بالسوق.',
  };
}
