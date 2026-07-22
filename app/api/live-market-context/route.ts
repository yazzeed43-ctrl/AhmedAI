import { NextRequest, NextResponse } from 'next/server';

import {
  getLiveMarketContext,
  type LiveContextTimeframe,
} from '@/lib/live-market-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const symbol = searchParams.get('symbol') || 'SPX';
    const timeframe =
      (searchParams.get('timeframe') as LiveContextTimeframe | null) ??
      '15min';
    const expiration = searchParams.get('expiration') || undefined;
    const includeOptions = readBoolean(
      searchParams.get('includeOptions')
    );

    const context = await getLiveMarketContext({
      symbol,
      timeframe,
      expiration,
      includeOptions,
    });

    return NextResponse.json({
      ok: true,
      context,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'تعذر بناء سياق السوق الحي.';

    console.error('LIVE_MARKET_CONTEXT_GET_FAILED', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const context = await getLiveMarketContext({
      symbol: body?.symbol,
      timeframe: body?.timeframe,
      expiration: body?.expiration,
      includeOptions: readBoolean(body?.includeOptions),
      socialMinutes: body?.socialMinutes,
      socialLimit: body?.socialLimit,
      tradingViewLimit: body?.tradingViewLimit,
    });

    return NextResponse.json({
      ok: true,
      context,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'تعذر بناء سياق السوق الحي.';

    console.error('LIVE_MARKET_CONTEXT_POST_FAILED', error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
