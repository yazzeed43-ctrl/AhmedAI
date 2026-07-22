import { NextRequest, NextResponse } from 'next/server';
import { getTelegramMessage, getTelegramSource, getTelegramText, parseTelegramSignal, type TelegramUpdate } from '@/lib/social/telegram';
import { getTrustedSource, saveSocialSignal } from '@/lib/social/social-signals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidSecret(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const received = request.headers.get('x-telegram-bot-api-secret-token');
  return Boolean(expected && received === expected);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'fahd-telegram-webhook',
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
  });
}

export async function POST(request: NextRequest) {
  if (!isValidSecret(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const message = getTelegramMessage(update);
  if (!message) return NextResponse.json({ ok: true, ignored: true, reason: 'unsupported_update' });

  const text = getTelegramText(message);
  if (!text) return NextResponse.json({ ok: true, ignored: true, reason: 'empty_text' });

  const { sourceId, sourceName } = getTelegramSource(message);

  try {
    const trusted = await getTrustedSource('telegram', sourceId);
    if (!trusted) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'untrusted_source', sourceId, sourceName });
    }

    const parsed = parseTelegramSignal(text);
    const saved = await saveSocialSignal({
      platform: 'telegram',
      sourceName: trusted.display_name ?? sourceName,
      sourceId,
      messageId: String(message.message_id),
      symbol: parsed.symbol,
      content: text,
      signalType: parsed.signalType,
      sentiment: parsed.sentiment,
      confidence: parsed.confidence,
      reliabilityScore: Number(trusted.reliability_score ?? 0.5),
      publishedAt: new Date(message.date * 1000).toISOString(),
      rawData: update,
    });

    return NextResponse.json({ ok: true, saved: Boolean(saved), signal: parsed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'telegram_webhook_failed';
    console.error('Telegram webhook failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
