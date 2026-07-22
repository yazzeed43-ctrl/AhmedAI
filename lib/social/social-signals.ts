import { supabase } from '@/lib/supabase';

export type SocialSignalInput = {
  platform: 'telegram' | 'x';
  sourceName?: string | null;
  sourceId?: string | null;
  messageId?: string | null;
  symbol?: string | null;
  symbols?: string[];
  content: string;
  contentType?: string | null;
  contentTypes?: string[];
  marketImpact?: string | null;
  signalType?: string | null;
  sentiment?: string | null;
  confidence?: number | null;
  reliabilityScore?: number | null;
  publishedAt?: string | null;
  rawData?: unknown;
};

export async function getTrustedSource(
  platform: 'telegram' | 'x',
  sourceId: string
) {
  const { data, error } = await supabase
    .from('trusted_sources')
    .select(
      'source_id, display_name, category, reliability_score, is_active'
    )
    .eq('platform', platform)
    .eq('source_id', sourceId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `تعذر فحص المصدر الموثوق: ${error.message}`
    );
  }

  return data;
}

export async function saveSocialSignal(
  input: SocialSignalInput
) {
  const normalizedSymbols = [
    ...new Set(
      (input.symbols ?? [])
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  const primarySymbol =
    input.symbol?.trim().toUpperCase() ??
    normalizedSymbols[0] ??
    null;

  const normalizedContentTypes = [
    ...new Set(
      (input.contentTypes ?? [])
        .map((type) => type.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  const { data, error } = await supabase
    .from('social_signals')
    .upsert(
      {
        platform: input.platform,
        source_name: input.sourceName ?? null,
        source_id: input.sourceId ?? null,
        message_id: input.messageId ?? null,
        symbol: primarySymbol,
        symbols: normalizedSymbols,
        content: input.content,
        content_type:
          input.contentType?.trim().toUpperCase() ??
          null,
        content_types: normalizedContentTypes,
        market_impact:
          input.marketImpact?.trim().toUpperCase() ??
          null,
        signal_type:
          input.signalType?.trim().toUpperCase() ??
          null,
        sentiment:
          input.sentiment?.trim().toLowerCase() ??
          null,
        confidence: input.confidence ?? null,
        reliability_score:
          input.reliabilityScore ?? null,
        published_at: input.publishedAt ?? null,
        raw_data: input.rawData ?? null,
      },
      {
        onConflict: 'content_hash',
        ignoreDuplicates: true,
      }
    )
    .select(
      'id, symbol, symbols, content_type, content_types, market_impact'
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `تعذر حفظ الإشارة الاجتماعية: ${error.message}`
    );
  }

  return data;
}

export async function getRecentSocialSignals(params?: {
  symbol?: string;
  platform?: 'telegram' | 'x';
  minutes?: number;
  limit?: number;
}) {
  const minutes = Math.max(
    1,
    Math.min(params?.minutes ?? 180, 1440)
  );

  const limit = Math.max(
    1,
    Math.min(params?.limit ?? 20, 100)
  );

  const since = new Date(
    Date.now() - minutes * 60_000
  ).toISOString();

  let query = supabase
    .from('social_signals')
    .select(
      [
        'id',
        'platform',
        'source_name',
        'source_id',
        'message_id',
        'symbol',
        'symbols',
        'content',
        'content_type',
        'content_types',
        'market_impact',
        'signal_type',
        'sentiment',
        'confidence',
        'reliability_score',
        'published_at',
        'created_at',
      ].join(', ')
    )
    .gte('published_at', since)
    .order('published_at', {
      ascending: false,
    })
    .limit(limit);

  if (params?.platform) {
    query = query.eq(
      'platform',
      params.platform
    );
  }

  if (params?.symbol) {
    const symbol =
      params.symbol.trim().toUpperCase();

    query = query.or(
      `symbol.eq.${symbol},symbols.cs.{${symbol}}`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `تعذر جلب الإشارات الاجتماعية: ${error.message}`
    );
  }

  return data ?? [];
}

export function summarizeSocialSignals(
  signals: any[]
) {
  const weightedScore = signals.reduce(
    (sum, item) => {
      const direction =
        item.sentiment === 'bullish'
          ? 1
          : item.sentiment === 'bearish'
            ? -1
            : 0;

      return (
        sum +
        direction *
          Number(item.confidence ?? 0.5) *
          Number(
            item.reliability_score ?? 0.5
          )
      );
    },
    0
  );

  const highImpact = signals.filter(
    (item) =>
      item.market_impact === 'HIGH'
  );

  const earnings = signals.filter(
    (item) =>
      item.content_type === 'EARNINGS' ||
      item.content_types?.includes?.(
        'EARNINGS'
      )
  );

  const breaking = signals.filter(
    (item) =>
      item.content_type === 'BREAKING' ||
      item.content_types?.includes?.(
        'BREAKING'
      )
  );

  return {
    total: signals.length,
    bullish: signals.filter(
      (item) =>
        item.sentiment === 'bullish'
    ).length,
    bearish: signals.filter(
      (item) =>
        item.sentiment === 'bearish'
    ).length,
    neutral: signals.filter(
      (item) =>
        item.sentiment === 'neutral'
    ).length,
    highImpactCount: highImpact.length,
    earningsCount: earnings.length,
    breakingCount: breaking.length,
    weightedScore: Number(
      weightedScore.toFixed(3)
    ),
    bias:
      weightedScore > 0.4
        ? 'BULLISH'
        : weightedScore < -0.4
          ? 'BEARISH'
          : 'NEUTRAL',
    signals,
  };
}