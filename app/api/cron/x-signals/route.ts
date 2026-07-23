import {
  NextRequest,
  NextResponse,
} from 'next/server';

import {
  collectTrustedXSignals,
} from '@/lib/social/x-collector';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(
  request: NextRequest
): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return (
    request.headers.get('authorization') ===
      `Bearer ${cronSecret}` ||
    request.headers.get('x-cron-secret') ===
      cronSecret
  );
}

export async function GET(
  request: NextRequest
) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'CRON_SECRET غير موجود في متغيرات البيئة',
      },
      { status: 503 }
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'غير مصرح',
      },
      { status: 401 }
    );
  }

  try {
    const result =
      await collectTrustedXSignals({
        windowSeconds: 600,
      });

    return NextResponse.json({
      ok: true,
      result,
      executedAt:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      'X collector cron failed:',
      message
    );

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
