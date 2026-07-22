import {
  rsi,
  macd,
  bollingerBands,
  findSupportResistance,
} from '@/lib/technical-indicators';

import { getPreviousDayVolumeProfile } from '@/lib/massive';

const TWELVE_DATA_TOKEN = process.env.TWELVE_DATA_API_KEY;

type AllowedInterval =
  | '1min'
  | '5min'
  | '15min'
  | '30min'
  | '45min'
  | '1h'
  | '2h'
  | '4h'
  | '1day'
  | '1week';

type DataFreshness =
  | 'recent'
  | 'delayed'
  | 'stale'
  | 'historical'
  | 'unknown';

interface CandleValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface TwelveDataResponse {
  meta?: {
    symbol?: string;
    interval?: string;
    currency?: string;
    exchange?: string;
    exchange_timezone?: string;
    type?: string;
  };

  values?: CandleValue[];
  status?: string;
  code?: number;
  message?: string;
}

export interface TechnicalIndicatorsResult {
  symbol: string;

  /**
   * الرمز الذي نجح فعلياً لدى Twelve Data.
   * مثال:
   * symbol = SPX
   * providerSymbol = GSPC
   */
  providerSymbol?: string;

  /**
   * الرمز المستخدم لدى Massive.
   * مثال:
   * SPX -> I:SPX
   */
  volumeProfileSymbol?: string;

  timeframe: AllowedInterval;

  lastPrice: number;

  priceLabel: string;

  dataStatus: {
    source: 'Twelve Data';
    candleTime: string;
    candleTimeUtc: string | null;
    fetchedAt: string;
    requestedTimezone: 'UTC' | null;
    exchangeTimezone: string | null;
    freshness: DataFreshness;
    ageMinutes: number | null;
    isRealtime: false;
    isCompletedCandle: true;
    excludedIncompleteCandle: boolean;
    excludedCandleTime: string | null;
    warning: string | null;
  };

  rsi: {
    value: number;
    signal: string;
  };

  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
    previousHistogram: number;
    signal: string;
  };

  bollingerBands: {
    upper: number;
    mid: number;
    lower: number;
    positionPercent: number | null;
    signal: string;
  };

  supportResistance: {
    support: number;
    resistance: number;
    val?: number;
    vah?: number;
    poc?: number;
    profileDate?: string;
    source: 'volume_profile' | 'historical_range';
    note: string;
  };
}

const ALLOWED_INTERVALS = new Set<AllowedInterval>([
  '1min',
  '5min',
  '15min',
  '30min',
  '45min',
  '1h',
  '2h',
  '4h',
  '1day',
  '1week',
]);

const INTERVAL_MAP: Record<string, AllowedInterval> = {
  '1MIN': '1min',
  '1M': '1min',

  '5MIN': '5min',
  '5M': '5min',

  '15MIN': '15min',
  '15M': '15min',

  '30MIN': '30min',
  '30M': '30min',

  '45MIN': '45min',
  '45M': '45min',

  '1H': '1h',
  '2H': '2h',
  '4H': '4h',

  '1DAY': '1day',
  '1D': '1day',
  D: '1day',
  DAY: '1day',
  DAILY: '1day',

  '1WEEK': '1week',
  '1W': '1week',
  W: '1week',
  WEEK: '1week',
  WEEKLY: '1week',
};

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.^:-]{0,19}$/;

/**
 * الرموز التي نجربها في Twelve Data.
 *
 * ملاحظة مهمة: "SPX" ليس رمزاً معترفاً به لدى Twelve Data (يرجع 404 دائماً)،
 * لذلك تم حذفه نهائياً من قائمة المحاولات لمؤشر S&P 500.
 * الرمز الفعلي المدعوم هو GSPC أو ^GSPC فقط.
 *
 * عند طلب SPX:
 * 1. نحاول GSPC
 * 2. ثم ^GSPC
 */
const TWELVE_DATA_SYMBOL_CANDIDATES: Record<string, string[]> = {
  SPX: ['GSPC', '^GSPC'],

  SPXW: ['GSPC', '^GSPC'],

  'SPX.X': ['GSPC', '^GSPC'],

  '$SPX': ['GSPC', '^GSPC'],

  GSPC: ['GSPC', '^GSPC'],

  '^GSPC': ['^GSPC', 'GSPC'],
};

/**
 * رموز Massive / Polygon.
 *
 * المؤشرات في Massive غالباً تستخدم بادئة I:
 */
const MASSIVE_SYMBOL_MAP: Record<string, string> = {
  SPX: 'I:SPX',
  SPXW: 'I:SPX',
  'SPX.X': 'I:SPX',
  '$SPX': 'I:SPX',
  GSPC: 'I:SPX',
  '^GSPC': 'I:SPX',
};

/**
 * يحول الأسماء البديلة إلى اسم داخلي موحد.
 *
 * SPXW ليس أصلاً مستقلاً للتحليل الفني؛
 * الأصل الأساسي لعقوده هو SPX.
 *
 * هذا التطبيع يُطبَّق أولاً وقبل بناء مفتاح الكاش،
 * حتى لا تتكوّن مفاتيح مختلفة (SPX / SPXW / GSPC...) لنفس البيانات فعلياً.
 */
function normalizeRequestedSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().trim();

  if (
    normalized === 'SPXW' ||
    normalized === 'SPX.X' ||
    normalized === '$SPX' ||
    normalized === 'GSPC' ||
    normalized === '^GSPC'
  ) {
    return 'SPX';
  }

  return normalized;
}

function getTwelveDataCandidates(symbol: string): string[] {
  const normalized = symbol.toUpperCase().trim();

  return TWELVE_DATA_SYMBOL_CANDIDATES[normalized] ?? [normalized];
}

function getMassiveSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().trim();

  return MASSIVE_SYMBOL_MAP[normalized] ?? normalized;
}

function normalizeInterval(
  timeframe: string
): AllowedInterval | null {
  const normalized = timeframe.trim().toUpperCase();

  const mappedInterval =
    INTERVAL_MAP[normalized];

  if (
    mappedInterval &&
    ALLOWED_INTERVALS.has(mappedInterval)
  ) {
    return mappedInterval;
  }

  const directInterval =
    timeframe.trim().toLowerCase() as AllowedInterval;

  if (ALLOWED_INTERVALS.has(directInterval)) {
    return directInterval;
  }

  return null;
}

function isIntradayInterval(
  interval: AllowedInterval
): boolean {
  return (
    interval.endsWith('min') ||
    interval === '1h' ||
    interval === '2h' ||
    interval === '4h'
  );
}

function intervalMinutes(
  interval: AllowedInterval
): number | null {
  if (interval.endsWith('min')) {
    const minutes = Number.parseInt(
      interval.replace('min', ''),
      10
    );

    return Number.isFinite(minutes)
      ? minutes
      : null;
  }

  if (interval === '1h') return 60;
  if (interval === '2h') return 120;
  if (interval === '4h') return 240;

  return null;
}

function parseIntradayUtcCandleTime(
  datetime: string
): Date | null {
  if (!datetime) {
    return null;
  }

  const normalized =
    datetime.trim().replace(' ', 'T');

  const hasExplicitTimezone =
    normalized.endsWith('Z') ||
    /[+-]\d{2}:\d{2}$/.test(normalized);

  const isoDatetime =
    hasExplicitTimezone
      ? normalized
      : `${normalized}Z`;

  const parsed = new Date(isoDatetime);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed;
}

interface IntradayCandleTiming {
  candleStart: Date;
  candleEnd: Date;
  rawAgeMinutes: number;
  isIncomplete: boolean;
}

function getIntradayCandleTiming(
  candleDatetime: string,
  interval: AllowedInterval
): IntradayCandleTiming | null {
  const minutesPerCandle =
    intervalMinutes(interval);

  if (!minutesPerCandle) {
    return null;
  }

  const candleStart =
    parseIntradayUtcCandleTime(candleDatetime);

  if (!candleStart) {
    return null;
  }

  const candleEnd = new Date(
    candleStart.getTime() +
      minutesPerCandle * 60_000
  );

  const rawAgeMinutes =
    (Date.now() - candleEnd.getTime()) /
    60_000;

  return {
    candleStart,
    candleEnd,
    rawAgeMinutes,
    isIncomplete: rawAgeMinutes < 0,
  };
}

function calculateIntradayFreshness(
  candleDatetime: string,
  interval: AllowedInterval
): {
  freshness: DataFreshness;
  ageMinutes: number | null;
  candleTimeUtc: string | null;
  warning: string | null;
} {
  const timing = getIntradayCandleTiming(
    candleDatetime,
    interval
  );

  if (!timing) {
    return {
      freshness: 'unknown',
      ageMinutes: null,
      candleTimeUtc: null,
      warning:
        'تعذر قراءة وقت آخر شمعة مكتملة؛ لا يمكن التأكد من حداثة البيانات.',
    };
  }

  if (timing.rawAgeMinutes < 0) {
    return {
      freshness: 'unknown',
      ageMinutes: null,
      candleTimeUtc:
        timing.candleStart.toISOString(),
      warning:
        'آخر شمعة المستخدمة تبدو غير مكتملة؛ لم يتم اعتماد حداثة البيانات.',
    };
  }

  const ageMinutes =
    Math.floor(timing.rawAgeMinutes);

  const minutesPerCandle =
    intervalMinutes(interval) ?? 5;

  const recentThresholdMinutes =
    Math.max(
      minutesPerCandle * 2,
      10
    );

  const delayedThresholdMinutes =
    Math.max(
      recentThresholdMinutes * 3,
      60
    );

  if (
    ageMinutes <= recentThresholdMinutes
  ) {
    return {
      freshness: 'recent',
      ageMinutes,
      candleTimeUtc:
        timing.candleStart.toISOString(),
      warning:
        'البيانات حديثة، لكنها شموع مجمعة وليست Quote لحظياً مباشراً.',
    };
  }

  if (
    ageMinutes <= delayedThresholdMinutes
  ) {
    return {
      freshness: 'delayed',
      ageMinutes,
      candleTimeUtc:
        timing.candleStart.toISOString(),
      warning:
        `آخر شمعة مكتملة متأخرة تقريباً ${ageMinutes} دقيقة.`,
    };
  }

  return {
    freshness: 'stale',
    ageMinutes,
    candleTimeUtc:
      timing.candleStart.toISOString(),
    warning:
      'آخر شمعة المكتملة قديمة. قد يكون السوق مغلقاً أو تغذية البيانات غير محدثة؛ لا تستخدم السعر كأنه لحظي.',
  };
}

function assertFiniteNumber(
  value: number,
  name: string
): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `تعذر حساب ${name} بسبب بيانات ناقصة أو غير صالحة`
    );
  }
}

function parsePriceArray(
  values: CandleValue[],
  field: 'close' | 'high' | 'low'
): number[] {
  return values.map((value) =>
    Number.parseFloat(value[field])
  );
}

function hasValidCandles(
  data: TwelveDataResponse
): data is TwelveDataResponse & {
  values: CandleValue[];
} {
  return (
    data.status !== 'error' &&
    Array.isArray(data.values) &&
    data.values.length > 0
  );
}

/**
 * خطأ مخصص لتفرقة "توقف فوري" (rate limit / auth / server error)
 * عن "جرّب alias التالي" (404 / رمز غير معروف).
 */
class NonRetryableProviderError extends Error {}

async function fetchTwelveDataTimeSeries(
  requestedSymbol: string,
  interval: AllowedInterval,
  intraday: boolean
): Promise<{
  data: TwelveDataResponse & {
    values: CandleValue[];
  };
  providerSymbol: string;
}> {
  if (!TWELVE_DATA_TOKEN) {
    throw new Error(
      'مفتاح TWELVE_DATA_API_KEY غير موجود في متغيرات البيئة'
    );
  }

  const candidates =
    getTwelveDataCandidates(requestedSymbol);

  const errors: string[] = [];

  for (const candidate of candidates) {
    const params = new URLSearchParams({
      symbol: candidate,
      interval,
      outputsize: '120',
      apikey: TWELVE_DATA_TOKEN,
      format: 'JSON',
      order: 'DESC',
    });

    if (intraday) {
      params.set('timezone', 'UTC');
    }

    try {
      const response = await fetch(
        `https://api.twelvedata.com/time_series?${params.toString()}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(
            12_000
          ),
        }
      );

      // 429 / 401 / 403 / 500+ = مشكلة عامة بالمفتاح أو بالخدمة نفسها.
      // محاولة alias آخر بنفس اللحظة مضمونة تفشل بنفس الطريقة وتهدر محاولة إضافية.
      // نوقف فوراً بدل ما نكمل الحلقة.
      if (
        response.status === 429 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status >= 500
      ) {
        if (response.status === 429) {
          console.warn(
            `[TwelveData] Rate limit hit for ${candidate} (${interval})`
          );
        } else {
          console.warn(
            `[TwelveData] Non-retryable error ${response.status} for ${candidate} (${interval})`
          );
        }

        throw new NonRetryableProviderError(
          `${candidate}: HTTP ${response.status} (توقف فوري، بدون تجربة alias آخر)`
        );
      }

      if (!response.ok) {
        // مثال: 404 أو رمز غير معروف — هذي فقط الحالة اللي نسمح فيها بتجربة alias التالي
        errors.push(
          `${candidate}: HTTP ${response.status}`
        );

        continue;
      }

      const data =
        (await response.json()) as TwelveDataResponse;

      if (hasValidCandles(data)) {
        return {
          data,
          providerSymbol: candidate,
        };
      }

      errors.push(
        `${candidate}: ${
          data.message ||
          'لا توجد بيانات زمنية'
        }`
      );
    } catch (error: unknown) {
      if (error instanceof NonRetryableProviderError) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'خطأ غير معروف';

      errors.push(
        `${candidate}: ${message}`
      );
    }
  }

  throw new Error(
    `تعذر جلب بيانات ${requestedSymbol} من Twelve Data. المحاولات: ${errors.join(
      ' | '
    )}`
  );
}

/**
 * كاش + دمج الطلبات المتزامنة (in-flight promise deduplication).
 *
 * لماذا هذا ضروري: live-market-context يستدعي getTechnicalIndicators
 * بشكل مستقل من عدة مسارات (technical, market -> getMarketDecision, stock -> getStockDecision)
 * خلال نفس الطلب الواحد تقريباً في نفس اللحظة. بدون هذا الكاش، كل مسار
 * يطلق نداء API منفصل لنفس الرمز/الفريم، فيستهلك حد الطلبات بسرعة
 * قبل ما توصل محاولات الـ fallback (GSPC / ^GSPC).
 *
 * التخزين المؤقت يشمل النتيجة سواء نجحت أو رجعت {error}،
 * لأن تخزين الخطأ لمدة قصيرة مفيد بالذات في حالة 429:
 * يمنع الطلبات المتوازية الثانية من ضرب Twelve Data مرة ثانية فوراً.
 */
type IndicatorCacheEntry = {
  expiresAt: number;
  promise: Promise<TechnicalIndicatorsResult | { error: string }>;
};

const indicatorCache = new Map<string, IndicatorCacheEntry>();
const INDICATOR_CACHE_TTL_MS = 30_000;
const INDICATOR_CACHE_MAX_SIZE = 100;

/**
 * تنظيف انتهازي (Opportunistic Cleanup)، مناسب لبيئة Serverless.
 *
 * setInterval غير مجدٍ هنا لأن الـ instance في Vercel قد يموت بين طلب وآخر،
 * فيُستدعى هذا التنظيف مباشرة بعد كل .set() بدل الاعتماد على مؤقّت خلفي.
 * لا يفعل شيئاً طالما حجم الكاش صغير ومعقول (عدد الأصول محدود: SPX, SPY, QQQ...).
 */
function cleanupIndicatorCache() {
  if (indicatorCache.size <= INDICATOR_CACHE_MAX_SIZE) return;

  const now = Date.now();

  for (const [key, entry] of indicatorCache) {
    if (entry.expiresAt <= now) {
      indicatorCache.delete(key);
    }
  }
}

export async function getTechnicalIndicators(
  symbol: string,
  timeframe = '1day'
): Promise<
  TechnicalIndicatorsResult | {
    error: string;
  }
> {
  const rawSymbol = symbol.toUpperCase().trim();

  if (!rawSymbol) {
    return {
      error: 'رمز السهم مطلوب',
    };
  }

  if (!SYMBOL_PATTERN.test(rawSymbol)) {
    return {
      error:
        'صيغة الرمز غير صحيحة. استخدم رمزاً مثل AAPL أو SPY أو SPX أو BRK.B.',
    };
  }

  // التطبيع يتم هنا، قبل بناء مفتاح الكاش،
  // حتى تدخل SPX / SPXW / SPX.X / $SPX / GSPC / ^GSPC كلها تحت مفتاح واحد: SPX
  const normalizedSymbol = normalizeRequestedSymbol(rawSymbol);

  const normalizedTimeframe = normalizeInterval(timeframe);

  if (!normalizedTimeframe) {
    return {
      error:
        'الفريم غير مدعوم. الفريمات المسموحة: 1min، 5min، 15min، 30min، 45min، 1h، 2h، 4h، 1day، 1week.',
    };
  }

  const cacheKey = `${normalizedSymbol}:${normalizedTimeframe}`;
  const now = Date.now();

  const cached = indicatorCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = getTechnicalIndicatorsUncached(
    normalizedSymbol,
    normalizedTimeframe
  );

  indicatorCache.set(cacheKey, {
    expiresAt: now + INDICATOR_CACHE_TTL_MS,
    promise,
  });

  cleanupIndicatorCache();

  return promise;
}

async function getTechnicalIndicatorsUncached(
  sym: string,
  interval: AllowedInterval
): Promise<
  TechnicalIndicatorsResult | {
    error: string;
  }
> {
  if (!TWELVE_DATA_TOKEN) {
    return {
      error:
        'مفتاح TWELVE_DATA_API_KEY غير موجود في متغيرات البيئة',
    };
  }

  const intraday =
    isIntradayInterval(interval);

  try {
    const {
      data,
      providerSymbol,
    } =
      await fetchTwelveDataTimeSeries(
        sym,
        interval,
        intraday
      );

    let completedValues =
      [...data.values].reverse();

    let excludedIncompleteCandle =
      false;

    let excludedCandleTime:
      | string
      | null = null;

    if (
      intraday &&
      completedValues.length > 0
    ) {
      const latestCandidate =
        completedValues[
          completedValues.length - 1
        ];

      const latestTiming =
        getIntradayCandleTiming(
          latestCandidate.datetime,
          interval
        );

      if (
        latestTiming &&
        latestTiming.rawAgeMinutes < 0
      ) {
        excludedIncompleteCandle =
          true;

        excludedCandleTime =
          latestCandidate.datetime;

        completedValues =
          completedValues.slice(0, -1);
      }
    }

    if (completedValues.length < 50) {
      return {
        error:
          `لا توجد شموع مكتملة كافية لحساب المؤشرات بدقة على ${sym}. ` +
          `تم العثور على ${completedValues.length} شمعة مكتملة، ` +
          'ونحتاج إلى 50 شمعة على الأقل.',
      };
    }

    const closes =
      parsePriceArray(
        completedValues,
        'close'
      );

    const highs =
      parsePriceArray(
        completedValues,
        'high'
      );

    const lows =
      parsePriceArray(
        completedValues,
        'low'
      );

    if (
      closes.some(
        (value) =>
          !Number.isFinite(value)
      ) ||
      highs.some(
        (value) =>
          !Number.isFinite(value)
      ) ||
      lows.some(
        (value) =>
          !Number.isFinite(value)
      )
    ) {
      return {
        error:
          `بعض شموع ${sym} تحتوي على أسعار غير صالحة أو ناقصة`,
      };
    }

    const rsiSeries =
      rsi(closes, 14);

    const macdResult =
      macd(
        closes,
        12,
        26,
        9
      );

    const bbResult =
      bollingerBands(
        closes,
        20,
        2
      );

    const lastIdx =
      closes.length - 1;

    const previousIdx =
      lastIdx - 1;

    const latestCompletedCandle =
      completedValues[lastIdx];

    const lastPrice =
      closes[lastIdx];

    const lastRsi =
      rsiSeries[lastIdx];

    const lastMacd =
      macdResult.macdLine[lastIdx];

    const lastSignal =
      macdResult.signalLine[lastIdx];

    const lastHistogram =
      macdResult.histogram[lastIdx];

    const previousHistogram =
      macdResult.histogram[
        previousIdx
      ];

    const lastBbUpper =
      bbResult.upper[lastIdx];

    const lastBbMid =
      bbResult.mid[lastIdx];

    const lastBbLower =
      bbResult.lower[lastIdx];

    assertFiniteNumber(
      lastPrice,
      'آخر إغلاق'
    );

    assertFiniteNumber(
      lastRsi,
      'RSI'
    );

    assertFiniteNumber(
      lastMacd,
      'MACD'
    );

    assertFiniteNumber(
      lastSignal,
      'MACD Signal'
    );

    assertFiniteNumber(
      lastHistogram,
      'MACD Histogram'
    );

    assertFiniteNumber(
      previousHistogram,
      'Previous MACD Histogram'
    );

    assertFiniteNumber(
      lastBbUpper,
      'Bollinger Upper'
    );

    assertFiniteNumber(
      lastBbMid,
      'Bollinger Mid'
    );

    assertFiniteNumber(
      lastBbLower,
      'Bollinger Lower'
    );

    const freshnessResult =
      intraday
        ? calculateIntradayFreshness(
            latestCompletedCandle.datetime,
            interval
          )
        : {
            freshness:
              'historical' as DataFreshness,

            ageMinutes: null,

            candleTimeUtc: null,

            warning:
              'آخر شمعة يومية/أسبوعية مكتملة وفق توقيت البورصة. هذه بيانات تاريخية للتحليل الفني وليست سعراً لحظياً.',
          };

    let rsiSignal = 'محايد';

    if (lastRsi >= 70) {
      rsiSignal =
        'تشبع شرائي؛ ليس إشارة بيع منفردة ويحتاج تأكيداً من السعر والحجم';
    } else if (lastRsi <= 30) {
      rsiSignal =
        'تشبع بيعي؛ ليس إشارة شراء منفردة ويحتاج تأكيد انعكاس وحجم';
    } else if (lastRsi >= 55) {
      rsiSignal =
        'زخم إيجابي معتدل';
    } else if (lastRsi <= 45) {
      rsiSignal =
        'زخم سلبي معتدل';
    }

    let macdSignal = 'محايد';

    if (
      lastHistogram > 0 &&
      previousHistogram <= 0
    ) {
      macdSignal =
        'تقاطع صاعد جديد';
    } else if (
      lastHistogram < 0 &&
      previousHistogram >= 0
    ) {
      macdSignal =
        'تقاطع هابط جديد';
    } else if (
      lastHistogram > 0 &&
      lastHistogram >
        previousHistogram
    ) {
      macdSignal =
        'زخم صاعد يتسارع';
    } else if (
      lastHistogram > 0 &&
      lastHistogram <
        previousHistogram
    ) {
      macdSignal =
        'زخم صاعد يضعف';
    } else if (
      lastHistogram < 0 &&
      lastHistogram <
        previousHistogram
    ) {
      macdSignal =
        'زخم هابط يتسارع';
    } else if (
      lastHistogram < 0 &&
      lastHistogram >
        previousHistogram
    ) {
      macdSignal =
        'زخم هابط يتباطأ';
    }

    const bbWidth =
      lastBbUpper -
      lastBbLower;

    const bbPositionPercent =
      bbWidth > 0
        ? (
            (
              lastPrice -
              lastBbLower
            ) /
            bbWidth
          ) * 100
        : null;

    let bbSignal =
      'داخل النطاق الطبيعي';

    if (
      lastPrice > lastBbUpper
    ) {
      bbSignal =
        'فوق الحد العلوي؛ قوة سعرية أو تمدد مرتفع وليس إشارة بيع تلقائية';
    } else if (
      lastPrice < lastBbLower
    ) {
      bbSignal =
        'تحت الحد السفلي؛ ضغط بيعي أو تمدد مرتفع وليس إشارة شراء تلقائية';
    } else if (
      bbPositionPercent !== null &&
      bbPositionPercent >= 85
    ) {
      bbSignal =
        'قريب من الحد العلوي';
    } else if (
      bbPositionPercent !== null &&
      bbPositionPercent <= 15
    ) {
      bbSignal =
        'قريب من الحد السفلي';
    }

    let supportResistance:
      TechnicalIndicatorsResult[
        'supportResistance'
      ];

    const volumeProfileSymbol =
      getMassiveSymbol(sym);

    try {
      const volumeProfile =
        await getPreviousDayVolumeProfile(
          volumeProfileSymbol
        );

      if (
        volumeProfile &&
        !('error' in volumeProfile)
      ) {
        const val =
          Number(
            volumeProfile.val.toFixed(2)
          );

        const vah =
          Number(
            volumeProfile.vah.toFixed(2)
          );

        const poc =
          Number(
            volumeProfile.poc.toFixed(2)
          );

        supportResistance = {
          support: val,
          resistance: vah,
          val,
          vah,
          poc,
          profileDate:
            volumeProfile.date,
          source:
            'volume_profile',
          note:
            `Volume Profile لآخر جلسة تداول مكتملة بتاريخ ${volumeProfile.date}. ` +
            `VAL ${val} دعم مرجعي، ` +
            `VAH ${vah} مقاومة مرجعية، ` +
            `وPOC عند ${poc}. ` +
            'هذه المستويات مرجعية وليست أوامر دخول تلقائية.',
        };
      } else {
        const reason =
          volumeProfile &&
          'error' in volumeProfile
            ? volumeProfile.error
            : 'Volume Profile unavailable';

        throw new Error(reason);
      }
    } catch {
      const sr =
        findSupportResistance(
          highs,
          lows,
          50
        );

      supportResistance = {
        support:
          Number(
            sr.support.toFixed(2)
          ),

        resistance:
          Number(
            sr.resistance.toFixed(2)
          ),

        source:
          'historical_range',

        note:
          'مستويات احتياطية مبنية على أعلى قمة وأدنى قاع خلال آخر 50 شمعة مكتملة لأن Volume Profile غير متوفر. قد تكون بعيدة عن نطاق السعر الحالي ولا تُعامل كنقاط ارتداد دقيقة.',
      };
    }

    return {
      symbol: sym,

      providerSymbol,

      volumeProfileSymbol,

      timeframe: interval,

      lastPrice:
        Number(
          lastPrice.toFixed(4)
        ),

      priceLabel: intraday
        ? 'إغلاق آخر شمعة مكتملة'
        : 'إغلاق آخر شمعة يومية/أسبوعية مكتملة',

      dataStatus: {
        source: 'Twelve Data',

        candleTime:
          latestCompletedCandle.datetime,

        candleTimeUtc:
          freshnessResult.candleTimeUtc,

        fetchedAt:
          new Date().toISOString(),

        requestedTimezone:
          intraday
            ? 'UTC'
            : null,

        exchangeTimezone:
          data.meta
            ?.exchange_timezone ??
          null,

        freshness:
          freshnessResult.freshness,

        ageMinutes:
          freshnessResult.ageMinutes,

        isRealtime: false,

        isCompletedCandle: true,

        excludedIncompleteCandle,

        excludedCandleTime,

        warning:
          freshnessResult.warning,
      },

      rsi: {
        value:
          Number(
            lastRsi.toFixed(1)
          ),

        signal:
          rsiSignal,
      },

      macd: {
        macdLine:
          Number(
            lastMacd.toFixed(4)
          ),

        signalLine:
          Number(
            lastSignal.toFixed(4)
          ),

        histogram:
          Number(
            lastHistogram.toFixed(4)
          ),

        previousHistogram:
          Number(
            previousHistogram.toFixed(4)
          ),

        signal:
          macdSignal,
      },

      bollingerBands: {
        upper:
          Number(
            lastBbUpper.toFixed(2)
          ),

        mid:
          Number(
            lastBbMid.toFixed(2)
          ),

        lower:
          Number(
            lastBbLower.toFixed(2)
          ),

        positionPercent:
          bbPositionPercent === null
            ? null
            : Number(
                bbPositionPercent.toFixed(
                  1
                )
              ),

        signal:
          bbSignal,
      },

      supportResistance,
    };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (
        error.name ===
          'TimeoutError' ||
        error.name ===
          'AbortError'
      )
    ) {
      return {
        error:
          'انتهت مهلة الاتصال بمصدر المؤشرات الفنية',
      };
    }

    const message =
      error instanceof Error
        ? error.message
        : 'فشل حساب المؤشرات الفنية';

    return {
      error: message,
    };
  }
}