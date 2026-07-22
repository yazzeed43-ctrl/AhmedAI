import { getMarketDecision } from '@/lib/market-decision-engine';
import { getTechnicalIndicators } from '@/lib/market-indicators';
import { getStockDecision } from '@/lib/stock-decision-engine';
import {
  getOptionsChain,
  getTradierQuote,
} from '@/lib/tradier';
import { supabase } from '@/lib/supabase';
import {
  getRecentSocialSignals,
  summarizeSocialSignals,
} from '@/lib/social/social-signals';

export type LiveContextTimeframe = '5min' | '15min' | '1h' | '1day';

export type LiveMarketContextInput = {
  symbol: string;
  timeframe?: LiveContextTimeframe;
  expiration?: string;
  includeOptions?: boolean;
  socialMinutes?: number;
  socialLimit?: number;
  tradingViewLimit?: number;
};

type ContextSection<T = unknown> = {
  ok: boolean;
  data: T | null;
  error: string | null;
};

type CacheEntry = {
  expiresAt: number;
  data: unknown;
};

const CACHE_TTL_MS = 30_000;
const contextCache = new Map<string, CacheEntry>();

function normalizeSymbol(value: string): string {
  const symbol = String(value || '').trim().toUpperCase();

  if (!/^[A-Z0-9.^:-]{1,32}$/.test(symbol)) {
    throw new Error('صيغة الرمز غير صحيحة.');
  }

  return symbol;
}

function normalizeTimeframe(
  value?: LiveContextTimeframe
): LiveContextTimeframe {
  return value ?? '15min';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeSection<T>(
  operation: () => Promise<T>
): Promise<ContextSection<T>> {
  try {
    return {
      ok: true,
      data: await operation(),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: errorMessage(error),
    };
  }
}

async function getRecentTradingViewSignals(
  symbol: string,
  limit: number
) {
  const safeLimit = Math.max(1, Math.min(limit, 50));

  const { data, error } = await supabase
    .from('tradingview_signals')
    .select('symbol, signal_type, price, timeframe, raw_message, created_at')
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`تعذر جلب إشارات TradingView: ${error.message}`);
  }

  return data ?? [];
}

function buildAlignment(params: {
  market: ContextSection<any>;
  stock: ContextSection<any>;
  social: ContextSection<any>;
  tradingView: ContextSection<any>;
}) {
  const signals: Array<{
    source: string;
    direction: 'CALL' | 'PUT' | 'NEUTRAL';
    weight: number;
    reason: string;
  }> = [];

  const marketBias = params.market.data?.bias;
  if (marketBias === 'CALL_BIAS') {
    signals.push({
      source: 'market',
      direction: 'CALL',
      weight: 3,
      reason: 'Market Decision يميل إلى CALL',
    });
  } else if (marketBias === 'PUT_BIAS') {
    signals.push({
      source: 'market',
      direction: 'PUT',
      weight: 3,
      reason: 'Market Decision يميل إلى PUT',
    });
  }

  const stockBias = params.stock.data?.bias;
  if (
    stockBias === 'BULLISH' ||
    stockBias === 'CALL_BIAS' ||
    stockBias === 'LONG'
  ) {
    signals.push({
      source: 'stock',
      direction: 'CALL',
      weight: 3,
      reason: 'Stock Decision يميل للصعود',
    });
  } else if (
    stockBias === 'BEARISH' ||
    stockBias === 'PUT_BIAS' ||
    stockBias === 'SHORT'
  ) {
    signals.push({
      source: 'stock',
      direction: 'PUT',
      weight: 3,
      reason: 'Stock Decision يميل للهبوط',
    });
  }

  const socialBias = params.social.data?.summary?.bias;
  if (socialBias === 'BULLISH') {
    signals.push({
      source: 'social',
      direction: 'CALL',
      weight: 1,
      reason: 'الإشارات الاجتماعية صاعدة',
    });
  } else if (socialBias === 'BEARISH') {
    signals.push({
      source: 'social',
      direction: 'PUT',
      weight: 1,
      reason: 'الإشارات الاجتماعية هابطة',
    });
  }

  const tvSignals = Array.isArray(params.tradingView.data)
    ? params.tradingView.data
    : [];

  for (const item of tvSignals.slice(0, 5)) {
    const type = String(item?.signal_type || '').toUpperCase();

    if (
      type.includes('BUY') ||
      type.includes('CALL') ||
      type.includes('BULL')
    ) {
      signals.push({
        source: 'tradingview',
        direction: 'CALL',
        weight: 1,
        reason: `TradingView: ${type}`,
      });
    } else if (
      type.includes('SELL') ||
      type.includes('PUT') ||
      type.includes('BEAR')
    ) {
      signals.push({
        source: 'tradingview',
        direction: 'PUT',
        weight: 1,
        reason: `TradingView: ${type}`,
      });
    }
  }

  const callWeight = signals
    .filter((item) => item.direction === 'CALL')
    .reduce((sum, item) => sum + item.weight, 0);

  const putWeight = signals
    .filter((item) => item.direction === 'PUT')
    .reduce((sum, item) => sum + item.weight, 0);

  const totalWeight = callWeight + putWeight;

  let bias: 'CALL' | 'PUT' | 'NEUTRAL' = 'NEUTRAL';
  if (callWeight >= putWeight + 2) bias = 'CALL';
  if (putWeight >= callWeight + 2) bias = 'PUT';

  return {
    bias,
    callWeight,
    putWeight,
    confidence:
      totalWeight > 0
        ? Math.round(
            (Math.max(callWeight, putWeight) / totalWeight) * 100
          )
        : 0,
    aligned:
      bias !== 'NEUTRAL' &&
      Math.min(callWeight, putWeight) <= 1,
    reasons: signals,
    warning:
      'الـAlignment للتلخيص فقط ولا يُعد Trigger دخول. يجب انتظار تأكيد السعر والحجم.',
  };
}

export async function getLiveMarketContext(
  input: LiveMarketContextInput
) {
  const symbol = normalizeSymbol(input.symbol);
  const timeframe = normalizeTimeframe(input.timeframe);
  const socialMinutes = Math.max(
    1,
    Math.min(input.socialMinutes ?? 180, 1440)
  );
  const socialLimit = Math.max(
    1,
    Math.min(input.socialLimit ?? 20, 100)
  );
  const tradingViewLimit = Math.max(
    1,
    Math.min(input.tradingViewLimit ?? 10, 50)
  );
  const includeOptions = Boolean(
    input.includeOptions && input.expiration
  );

  const cacheKey = JSON.stringify({
    symbol,
    timeframe,
    expiration: input.expiration ?? null,
    includeOptions,
    socialMinutes,
    socialLimit,
    tradingViewLimit,
  });

  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...(cached.data as Record<string, unknown>),
      cache: {
        hit: true,
        ttlSeconds: Math.ceil(
          (cached.expiresAt - Date.now()) / 1000
        ),
      },
    };
  }

  const [
    quote,
    technical,
    market,
    stock,
    social,
    tradingView,
    options,
  ] = await Promise.all([
    safeSection(() => getTradierQuote(symbol)),
    safeSection(() =>
      getTechnicalIndicators(symbol, timeframe)
    ),
    safeSection(() =>
      getMarketDecision(
        timeframe === '5min' ? '15min' : timeframe
      )
    ),
    safeSection(() =>
      getStockDecision(
        symbol,
        timeframe === '5min' ? '15min' : timeframe
      )
    ),
    safeSection(async () => {
      const signals = await getRecentSocialSignals({
        symbol,
        minutes: socialMinutes,
        limit: socialLimit,
      });

      return {
        summary: summarizeSocialSignals(signals),
        signals,
      };
    }),
    safeSection(() =>
      getRecentTradingViewSignals(symbol, tradingViewLimit)
    ),
    includeOptions
      ? safeSection(() =>
          getOptionsChain(symbol, input.expiration!)
        )
      : Promise.resolve<ContextSection>({
          ok: true,
          data: null,
          error: null,
        }),
  ]);

  const alignment = buildAlignment({
    market,
    stock,
    social,
    tradingView,
  });

  const result = {
    generatedAt: new Date().toISOString(),
    symbol,
    timeframe,
    quote,
    technical,
    market,
    stock,
    social,
    tradingView,
    options: {
      ...options,
      requested: includeOptions,
      expiration: input.expiration ?? null,
    },
    alignment,
    health: {
      completeSections: [
        quote,
        technical,
        market,
        stock,
        social,
        tradingView,
      ].filter((section) => section.ok).length,
      totalSections: 6,
      partialFailure: [
        quote,
        technical,
        market,
        stock,
        social,
        tradingView,
      ].some((section) => !section.ok),
      providerErrors: [
        ['quote', quote.error],
        ['technical', technical.error],
        ['market', market.error],
        ['stock', stock.error],
        ['social', social.error],
        ['tradingView', tradingView.error],
        ['options', options.error],
      ]
        .filter(([, error]) => Boolean(error))
        .map(([source, error]) => ({ source, error })),
    },
    rules: {
      socialIsConfirmationOnly: true,
      tradingViewIsConfirmationOnly: true,
      alignmentIsNotEntryTrigger: true,
      doNotInventMissingData: true,
    },
    cache: {
      hit: false,
      ttlSeconds: CACHE_TTL_MS / 1000,
    },
  };

  contextCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data: result,
  });

  if (contextCache.size > 100) {
    for (const [key, entry] of contextCache) {
      if (entry.expiresAt <= Date.now()) {
        contextCache.delete(key);
      }
    }
  }

  return result;
}
