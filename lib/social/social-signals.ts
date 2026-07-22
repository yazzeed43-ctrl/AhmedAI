import { supabase } from '@/lib/supabase';

export async function getTrustedSource(platform: 'telegram' | 'x', sourceId: string) {
  const { data, error } = await supabase
    .from('trusted_sources')
    .select('source_id, display_name, category, reliability_score, is_active')
    .eq('platform', platform)
    .eq('source_id', sourceId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`تعذر فحص المصدر الموثوق: ${error.message}`);
  return data;
}

export async function saveSocialSignal(input: any) {
  const { data, error } = await supabase
    .from('social_signals')
    .upsert({
      platform: input.platform,
      source_name: input.sourceName,
      source_id: input.sourceId,
      message_id: input.messageId,
      symbol: input.symbol,
      content: input.content,
      signal_type: input.signalType,
      sentiment: input.sentiment,
      confidence: input.confidence,
      reliability_score: input.reliabilityScore,
      published_at: input.publishedAt,
      raw_data: input.rawData,
    }, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`تعذر حفظ الإشارة الاجتماعية: ${error.message}`);
  return data;
}

export async function getRecentSocialSignals(params?: { symbol?: string; platform?: 'telegram' | 'x'; minutes?: number; limit?: number; }) {
  const minutes = Math.max(1, Math.min(params?.minutes ?? 180, 1440));
  const limit = Math.max(1, Math.min(params?.limit ?? 20, 100));
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  let query = supabase
    .from('social_signals')
    .select('id, platform, source_name, source_id, message_id, symbol, content, signal_type, sentiment, confidence, reliability_score, published_at, created_at')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (params?.platform) query = query.eq('platform', params.platform);
  if (params?.symbol) query = query.eq('symbol', params.symbol.toUpperCase());

  const { data, error } = await query;
  if (error) throw new Error(`تعذر جلب الإشارات الاجتماعية: ${error.message}`);
  return data ?? [];
}

export function summarizeSocialSignals(signals: any[]) {
  const weightedScore = signals.reduce((sum, item) => {
    const direction = item.sentiment === 'bullish' ? 1 : item.sentiment === 'bearish' ? -1 : 0;
    return sum + direction * Number(item.confidence ?? 0.5) * Number(item.reliability_score ?? 0.5);
  }, 0);

  return {
    total: signals.length,
    bullish: signals.filter((x) => x.sentiment === 'bullish').length,
    bearish: signals.filter((x) => x.sentiment === 'bearish').length,
    neutral: signals.filter((x) => x.sentiment === 'neutral').length,
    weightedScore: Number(weightedScore.toFixed(3)),
    bias: weightedScore > 0.4 ? 'BULLISH' : weightedScore < -0.4 ? 'BEARISH' : 'NEUTRAL',
    signals,
  };
}
