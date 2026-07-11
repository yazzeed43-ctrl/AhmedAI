import { rsi, macd, bollingerBands, findSupportResistance } from '@/lib/technical-indicators';

const TWELVE_DATA_TOKEN = process.env.TWELVE_DATA_API_KEY!;

export interface TechnicalIndicatorsResult {
  symbol: string;
  timeframe: string;
  lastPrice: number;
  rsi: { value: number; signal: string };
  macd: { macdLine: number; signalLine: number; histogram: number; signal: string };
  bollingerBands: { upper: number; mid: number; lower: number; signal: string };
  supportResistance: { support: number; resistance: number; note: string };
}

export async function getTechnicalIndicators(
  symbol: string,
  timeframe = '1day'
): Promise<TechnicalIndicatorsResult | { error: string }> {
  const sym = symbol.toUpperCase().trim();
  const intervalMap: Record<string, string> = {
    '1D': '1day',
    D: '1day',
    '1W': '1week',
    '15MIN': '15min',
    '1H': '1h',
    '4H': '4h',
  };
  const interval = intervalMap[timeframe.toUpperCase()] || timeframe;

  try {
    const tdUrl = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=${interval}&outputsize=100&apikey=${TWELVE_DATA_TOKEN}`;
    const res = await fetch(tdUrl);
    const data = await res.json();

    if (data.status === 'error' || !data.values || data.values.length < 50) {
      return { error: `ما فيه بيانات كافية لحساب المؤشرات بدقة على ${sym} (نحتاج 50 شمعة على الأقل)` };
    }

    const values = [...data.values].reverse();
    const closes = values.map((v: any) => parseFloat(v.close));
    const highs = values.map((v: any) => parseFloat(v.high));
    const lows = values.map((v: any) => parseFloat(v.low));

    const rsiSeries = rsi(closes, 14);
    const macdResult = macd(closes, 12, 26, 9);
    const bbResult = bollingerBands(closes, 20, 2);
    const sr = findSupportResistance(highs, lows, 50);

    const lastIdx = closes.length - 1;
    const lastPrice = closes[lastIdx];
    const lastRsi = rsiSeries[lastIdx];
    const lastMacd = macdResult.macdLine[lastIdx];
    const lastSignal = macdResult.signalLine[lastIdx];
    const lastHist = macdResult.histogram[lastIdx];
    const lastBbUpper = bbResult.upper[lastIdx];
    const lastBbMid = bbResult.mid[lastIdx];
    const lastBbLower = bbResult.lower[lastIdx];

    let rsiSignal = 'محايد';
    if (lastRsi >= 70) rsiSignal = 'تشبع شرائي (Overbought)';
    else if (lastRsi <= 30) rsiSignal = 'تشبع بيعي (Oversold)';

    let macdSignal = 'محايد';
    if (lastHist > 0 && macdResult.histogram[lastIdx - 1] <= 0) macdSignal = 'تقاطع صاعد جديد';
    else if (lastHist < 0 && macdResult.histogram[lastIdx - 1] >= 0) macdSignal = 'تقاطع هابط جديد';
    else if (lastHist > 0) macdSignal = 'زخم صاعد';
    else if (lastHist < 0) macdSignal = 'زخم هابط';

    let bbSignal = 'داخل النطاق الطبيعي';
    if (lastPrice >= lastBbUpper) bbSignal = 'قريب/فوق النطاق العلوي - احتمال تصحيح';
    else if (lastPrice <= lastBbLower) bbSignal = 'قريب/تحت النطاق السفلي - احتمال ارتداد';

    return {
      symbol: sym,
      timeframe: interval,
      lastPrice,
      rsi: { value: Number(lastRsi.toFixed(1)), signal: rsiSignal },
      macd: {
        macdLine: Number(lastMacd.toFixed(3)),
        signalLine: Number(lastSignal.toFixed(3)),
        histogram: Number(lastHist.toFixed(3)),
        signal: macdSignal,
      },
      bollingerBands: {
        upper: Number(lastBbUpper.toFixed(2)),
        mid: Number(lastBbMid.toFixed(2)),
        lower: Number(lastBbLower.toFixed(2)),
        signal: bbSignal,
      },
      supportResistance: {
        support: Number(sr.support.toFixed(2)),
        resistance: Number(sr.resistance.toFixed(2)),
        note: 'أعلى قمة وأدنى قاع تقريبيين خلال آخر 50 شمعة - مستويات إرشادية أولية، مو نقاط ارتداد (Pivot) دقيقة',
      },
    };
  } catch (e: any) {
    return { error: e?.message || 'فشل حساب المؤشرات الفنية' };
  }
}
