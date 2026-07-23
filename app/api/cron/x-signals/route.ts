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

function getWindowSeconds(
  request: NextRequest
): number {
  const raw =
    request.nextUrl.searchParams.get('windowSeconds');

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return 130;
  }

  return Math.max(
    60,
    Math.min(Math.floor(parsed), 3600)
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
    const windowSeconds =
      getWindowSeconds(request);

    const result =
      await collectTrustedXSignals({
        windowSeconds,
      });

    return NextResponse.json({
      ok: true,
      windowSeconds,
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