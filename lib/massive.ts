// ============================================
// lib/massive.ts
// يستخدم Massive.com API لحساب Volume Profile الحقيقي
// (VAH / VAL / POC) لليوم السابق - بيانات تاريخية دقيقة
// متوافقة مع حدود الخطة المجانية (Minute Aggregates)
// ============================================

const MASSIVE_BASE = 'https://api.massive.com';

interface AggBar {
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  t: number; // timestamp
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

// آخر يوم تداول فعلي (يتجاوز عطلة نهاية الأسبوع تقريبياً)
function getLastTradingDay(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2); // الأحد -> الجمعة
  if (day === 6) d.setDate(d.getDate() - 1); // السبت -> الجمعة
  return d;
}

async function fetchMinuteBars(symbol: string, date: Date, apiKey: string): Promise<AggBar[]> {
  const dateStr = formatDate(date);
  const url = `${MASSIVE_BASE}/v2/aggs/ticker/${symbol}/range/5/minute/${dateStr}/${dateStr}?adjusted=true&sort=asc&limit=500`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Massive API error: ${res.status} - ${body}`);
  }
  const data = await res.json();
  return data.results || [];
}

// يحسب Volume Profile: يوزع حجم كل شمعة على نطاق سعرها (High-Low)
// بخطوات سعرية صغيرة، ثم يلقى القيمة الأعلى تجمعاً (POC)
// ونطاق Value Area اللي يحتوي 70% من الحجم الكلي حول POC (VAH/VAL)
function computeVolumeProfile(bars: AggBar[]) {
  if (bars.length === 0) return null;

  const allLows = bars.map((b) => b.l);
  const allHighs = bars.map((b) => b.h);
  const minPrice = Math.min(...allLows);
  const maxPrice = Math.max(...allHighs);
  const totalVolume = bars.reduce((sum, b) => sum + b.v, 0);

  const numBins = 50;
  const binSize = (maxPrice - minPrice) / numBins || 0.01;
  const volumeByBin: number[] = new Array(numBins).fill(0);

  for (const bar of bars) {
    const barRange = bar.h - bar.l || 0.01;
    const startBin = Math.floor((bar.l - minPrice) / binSize);
    const endBin = Math.floor((bar.h - minPrice) / binSize);
    const binsSpanned = Math.max(1, endBin - startBin + 1);
    const volumePerBin = bar.v / binsSpanned;
    for (let i = startBin; i <= endBin && i < numBins; i++) {
      if (i >= 0) volumeByBin[i] += volumePerBin;
    }
  }

  // POC: البن ذو أعلى حجم
  let pocBin = 0;
  for (let i = 1; i < numBins; i++) {
    if (volumeByBin[i] > volumeByBin[pocBin]) pocBin = i;
  }
  const poc = minPrice + (pocBin + 0.5) * binSize;

  // Value Area: نوسّع من POC للخارج حتى نجمع 70% من الحجم
  const targetVolume = totalVolume * 0.7;
  let accumulatedVolume = volumeByBin[pocBin];
  let lowBin = pocBin;
  let highBin = pocBin;

  while (accumulatedVolume < targetVolume && (lowBin > 0 || highBin < numBins - 1)) {
    const volBelow = lowBin > 0 ? volumeByBin[lowBin - 1] : -1;
    const volAbove = highBin < numBins - 1 ? volumeByBin[highBin + 1] : -1;
    if (volAbove >= volBelow) {
      highBin++;
      accumulatedVolume += volumeByBin[highBin];
    } else {
      lowBin--;
      accumulatedVolume += volumeByBin[lowBin];
    }
  }

  const val = minPrice + lowBin * binSize;
  const vah = minPrice + (highBin + 1) * binSize;

  const dayHigh = Math.max(...allHighs);
  const dayLow = Math.min(...allLows);
  const dayOpen = bars[0].o;
  const dayClose = bars[bars.length - 1].c;

  return {
    poc: Number(poc.toFixed(2)),
    vah: Number(vah.toFixed(2)),
    val: Number(val.toFixed(2)),
    day_high: dayHigh,
    day_low: dayLow,
    day_open: dayOpen,
    day_close: dayClose,
    total_volume: totalVolume,
  };
}

export async function getPreviousDayVolumeProfile(symbol: string) {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) {
    return { error: 'مفتاح Massive API غير مُعرّف' };
  }

  try {
    let date = getLastTradingDay();
    let bars = await fetchMinuteBars(symbol, date, apiKey);

    // لو ما فيه بيانات (يوم عطلة رسمية مثلاً)، جرب يوم قبله
    if (bars.length === 0) {
      date.setDate(date.getDate() - 1);
      bars = await fetchMinuteBars(symbol, date, apiKey);
    }

    if (bars.length === 0) {
      return { error: `لا توجد بيانات تداول متوفرة لـ ${symbol} بالأيام الأخيرة` };
    }

    const profile = computeVolumeProfile(bars);
    if (!profile) return { error: 'فشل حساب Volume Profile' };

    return {
      symbol,
      date: formatDate(date),
      source: 'Massive.com (بيانات فعلية 5-دقائق)',
      ...profile,
    };
  } catch (e: any) {
    return { error: e.message || 'فشل جلب بيانات Massive' };
  }
}
