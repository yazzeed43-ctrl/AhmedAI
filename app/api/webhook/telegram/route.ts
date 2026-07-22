import {
  NextRequest,
  NextResponse,
} from 'next/server';

import {
  getTelegramMessage,
  getTelegramSource,
  getTelegramText,
  parseTelegramSignal,
  type TelegramUpdate,
} from '@/lib/social/telegram';

import {
  getTrustedSource,
  saveSocialSignal,
} from '@/lib/social/social-signals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidSecret(
  request: NextRequest
): boolean {
  const expected =
    process.env.TELEGRAM_WEBHOOK_SECRET;

  const received = request.headers.get(
    'x-telegram-bot-api-secret-token'
  );

  return Boolean(
    expected &&
      received &&
      received === expected
  );
}

async function sendTelegramMessage(
  chatId: number | string,
  text: string
): Promise<boolean> {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error(
      'TELEGRAM_BOT_TOKEN is not configured'
    );

    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      const body = await response
        .text()
        .catch(() => '');

      console.error(
        'TELEGRAM_SEND_MESSAGE_HTTP_ERROR',
        {
          status: response.status,
          body,
          chatId,
        }
      );

      return false;
    }

    const result =
      await response.json();

    if (!result?.ok) {
      console.error(
        'TELEGRAM_SEND_MESSAGE_API_ERROR',
        result
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error(
      'TELEGRAM_SEND_MESSAGE_FAILED',
      error
    );

    return false;
  }
}

function formatContentTypeLabel(
  value: string
): string {
  const labels: Record<string, string> = {
    SIGNAL: '📈 إشارة تداول',
    NEWS: '📰 خبر',
    EARNINGS: '📅 أرباح',
    BREAKING: '🚨 عاجل',
    WHALE: '🐋 تدفقات حيتان',
    FED: '🏦 فيدرالي',
  };

  return labels[value] ?? value;
}

function formatMarketImpactLabel(
  value: string
): string {
  const labels: Record<string, string> = {
    LOW: 'منخفض',
    MEDIUM: 'متوسط',
    HIGH: 'مرتفع',
  };

  return labels[value] ?? value;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service:
      'fahd-telegram-webhook',
    configured: Boolean(
      process.env.TELEGRAM_BOT_TOKEN &&
        process.env
          .TELEGRAM_WEBHOOK_SECRET
    ),
  });
}

export async function POST(
  request: NextRequest
) {
  if (!isValidSecret(request)) {
    console.warn(
      'TELEGRAM_WEBHOOK_UNAUTHORIZED'
    );

    return NextResponse.json(
      {
        ok: false,
        error: 'unauthorized',
      },
      {
        status: 401,
      }
    );
  }

  let update: TelegramUpdate;

  try {
    update =
      (await request.json()) as TelegramUpdate;
  } catch (error) {
    console.error(
      'TELEGRAM_INVALID_JSON',
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_json',
      },
      {
        status: 400,
      }
    );
  }

  const telegramMessage =
    getTelegramMessage(update);

  if (!telegramMessage) {
    console.log(
      'TELEGRAM_IGNORED_UPDATE',
      {
        updateId: update.update_id,
        reason:
          'unsupported_update',
      }
    );

    return NextResponse.json({
      ok: true,
      ignored: true,
      reason:
        'unsupported_update',
    });
  }

  const text =
    getTelegramText(
      telegramMessage
    );

  if (!text) {
    console.log(
      'TELEGRAM_IGNORED_UPDATE',
      {
        updateId: update.update_id,
        messageId:
          telegramMessage.message_id,
        reason: 'empty_text',
      }
    );

    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: 'empty_text',
    });
  }

  const {
    sourceId,
    sourceName,
  } = getTelegramSource(
    telegramMessage
  );

  const chatId =
    telegramMessage?.chat?.id;

  try {
    const trusted =
      await getTrustedSource(
        'telegram',
        sourceId
      );

    if (!trusted) {
      console.log(
        'TELEGRAM_UNTRUSTED_SOURCE',
        {
          sourceId,
          sourceName,
          chatId,
          chatType:
            telegramMessage?.chat
              ?.type ?? null,
          username:
            telegramMessage?.from
              ?.username ??
            telegramMessage?.chat
              ?.username ??
            null,
          messageId:
            telegramMessage
              ?.message_id ?? null,
          textPreview:
            text.slice(0, 120),
        }
      );

      if (chatId) {
        await sendTelegramMessage(
          chatId,
          [
            'تم استلام رسالتك ✅',
            '',
            'لكن حسابك غير مضاف كمصدر موثوق حتى الآن.',
            '',
            `Source ID: ${sourceId}`,
            '',
            'أرسل هذا الرقم إلى مسؤول النظام لإضافته في trusted_sources.',
          ].join('\n')
        );
      }

      return NextResponse.json({
        ok: true,
        ignored: true,
        reason:
          'untrusted_source',
        sourceId,
        sourceName,
      });
    }

    const parsed =
      parseTelegramSignal(text);

    const saved =
      await saveSocialSignal({
        platform: 'telegram',
        sourceName:
          trusted.display_name ??
          sourceName,
        sourceId,
        messageId: String(
          telegramMessage.message_id
        ),
        symbol:
          parsed.symbol,
        symbols:
          parsed.symbols,
        content: text,
        contentType:
          parsed.contentType,
        contentTypes:
          parsed.contentTypes,
        marketImpact:
          parsed.marketImpact,
        signalType:
          parsed.signalType,
        sentiment:
          parsed.sentiment,
        confidence:
          parsed.confidence,
        reliabilityScore:
          Number(
            trusted.reliability_score ??
              0.5
          ),
        publishedAt:
          new Date(
            telegramMessage.date *
              1000
          ).toISOString(),
        rawData: {
          telegramUpdate: update,
          parsed,
        },
      });

    console.log(
      'TELEGRAM_SIGNAL_SAVED',
      {
        sourceId,
        sourceName:
          trusted.display_name ??
          sourceName,
        messageId:
          telegramMessage.message_id,
        symbol:
          parsed.symbol,
        symbols:
          parsed.symbols,
        contentType:
          parsed.contentType,
        contentTypes:
          parsed.contentTypes,
        marketImpact:
          parsed.marketImpact,
        signalType:
          parsed.signalType,
        sentiment:
          parsed.sentiment,
        confidence:
          parsed.confidence,
        saved:
          Boolean(saved),
      }
    );

    if (chatId) {
      const symbolsLabel =
        parsed.symbols.length > 0
          ? parsed.symbols.join(', ')
          : 'غير محددة';

      const contentTypesLabel =
        parsed.contentTypes.length > 0
          ? parsed.contentTypes
              .map(
                formatContentTypeLabel
              )
              .join('، ')
          : 'غير محددة';

      const replyLines = [
        parsed.contentType ===
        'SIGNAL'
          ? 'تم استلام الإشارة وحفظها ✅'
          : 'تم استلام المحتوى وحفظه ✅',
        '',
        `الرموز: ${symbolsLabel}`,
        `نوع المحتوى: ${formatContentTypeLabel(
          parsed.contentType
        )}`,
        `التصنيفات: ${contentTypesLabel}`,
        `تأثير السوق: ${formatMarketImpactLabel(
          parsed.marketImpact
        )}`,
        `نوع الإشارة: ${
          parsed.signalType ??
          'غير محدد'
        }`,
        `الاتجاه: ${
          parsed.sentiment
        }`,
        `الثقة: ${Math.round(
          parsed.confidence * 100
        )}%`,
      ];

      if (
        parsed.marketImpact ===
        'HIGH'
      ) {
        replyLines.push(
          '',
          '⚠️ حدث مرتفع التأثير؛ سيأخذه فهد في الحسبان أثناء التحليل.'
        );
      }

      await sendTelegramMessage(
        chatId,
        replyLines.join('\n')
      );
    }

    return NextResponse.json({
      ok: true,
      saved: Boolean(saved),
      signal: {
        symbol:
          parsed.symbol,
        symbols:
          parsed.symbols,
        contentType:
          parsed.contentType,
        contentTypes:
          parsed.contentTypes,
        marketImpact:
          parsed.marketImpact,
        signalType:
          parsed.signalType,
        sentiment:
          parsed.sentiment,
        confidence:
          parsed.confidence,
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'telegram_webhook_failed';

    console.error(
      'TELEGRAM_WEBHOOK_FAILED',
      {
        sourceId,
        sourceName,
        messageId:
          telegramMessage.message_id,
        error: errorMessage,
      }
    );

    if (chatId) {
      await sendTelegramMessage(
        chatId,
        [
          'حدث خطأ أثناء معالجة الرسالة ❌',
          '',
          'حاول مرة أخرى بعد قليل.',
        ].join('\n')
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
      },
      {
        status: 500,
      }
    );
  }
}