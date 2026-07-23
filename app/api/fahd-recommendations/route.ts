import {
  NextRequest,
  NextResponse,
} from 'next/server';

import {
  runFahdScannerV3,
} from '@/lib/trading/fahd-scanner-v3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_SYMBOLS = [
  'SPY',
  'QQQ',
  'AAPL',
  'NVDA',
  'TSLA',
  'AMZN',
  'META',
  'AMD',
  'MSFT',
];

type RequestBody = {
  symbols?: unknown;
  maxRiskUsd?: unknown;
  maxResults?: unknown;
  timeframe?: unknown;
  maxDte?: unknown;
};

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SYMBOLS;
  }

  const symbols = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z][A-Z0-9.]{0,9}$/.test(item));

  return symbols.length > 0
    ? [...new Set(symbols)].slice(0, 20)
    : DEFAULT_SYMBOLS;
}

function numberBetween(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeTimeframe(
  value: unknown
): '15min' | '1h' | '1day' {
  return value === '1h' || value === '1day'
    ? value
    : '15min';
}

function buildRiskPlan(
  midpoint: number,
  score: number,
  maxRiskUsd: number
) {
  const entry = midpoint;
  const stopPercent = score >= 90 ? 0.25 : 0.3;
  const stop = Number(
    Math.max(0.01, entry * (1 - stopPercent)).toFixed(2)
  );
  const target1 = Number((entry * 1.35).toFixed(2));
  const target2 = Number((entry * 1.7).toFixed(2));
  const riskPerContract = Number(
    ((entry - stop) * 100).toFixed(2)
  );
  const costPerContract = Number((entry * 100).toFixed(2));
  const suggestedContracts =
    riskPerContract > 0
      ? Math.floor(maxRiskUsd / riskPerContract)
      : 0;

  return {
    entry,
    stop,
    target1,
    target2,
    riskPerContract,
    costPerContract,
    maxRiskUsd,
    suggestedContracts: Math.max(0, suggestedContracts),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const symbols = normalizeSymbols(body.symbols);
    const maxRiskUsd = numberBetween(
      body.maxRiskUsd,
      100,
      25,
      10_000
    );
    const maxResults = Math.floor(
      numberBetween(body.maxResults, 2, 1, 2)
    );
    const maxDte = Math.floor(
      numberBetween(body.maxDte, 7, 1, 14)
    );

    const result = await runFahdScannerV3({
      symbols,
      timeframe: normalizeTimeframe(body.timeframe),
      maxDte,
      expirationsPerSymbol: 3,
      maxResults,
      minPrice: 0.3,
      maxPrice: 15,
      minVolume: 100,
      minOpenInterest: 500,
      maxSpreadPercent: 12,
      minDelta: 0.45,
      maxDelta: 0.7,
      minimumFinalScore: 80,
    });

    if (
      result.status === 'WAIT' ||
      result.opportunities.length === 0
    ) {
      return NextResponse.json({
        success: true,
        action: 'WAIT',
        market: result.market,
        recommendations: [],
        message: result.message,
        generatedAt: new Date().toISOString(),
      });
    }

    const recommendations = result.opportunities.map((item) => {
      const riskPlan = buildRiskPlan(
        item.midpoint,
        item.finalScore,
        maxRiskUsd
      );

      const executable =
        item.finalScore >= 85 &&
        item.score >= 80 &&
        riskPlan.suggestedContracts >= 1;

      return {
        rank: item.rank,
        action: executable ? 'BUY' : 'WATCH',
        underlying: item.underlying,
        direction: item.direction,
        contractSymbol: item.contractSymbol,
        expiration: item.expiration,
        daysToExpiration: item.daysToExpiration,
        strike: item.strike,
        underlyingPrice: item.underlyingPrice,
        underlyingChangePercent: item.underlyingChangePercent,
        bid: item.bid,
        ask: item.ask,
        midpoint: item.midpoint,
        delta: item.delta,
        theta: item.theta,
        impliedVolatility: item.impliedVolatility,
        volume: item.volume,
        openInterest: item.openInterest,
        spreadPercent: item.spreadPercent,
        contractScore: item.score,
        marketScore: item.marketScore,
        finalScore: item.finalScore,
        reasons: item.reasons,
        warnings: item.warnings,
        riskPlan,
        trigger: executable
          ? 'انتظر تأكيد الاختراق أو الكسر قبل التنفيذ'
          : 'راقب ولا تدخل حتى تتحسن الدرجة والتفعيل',
      };
    });

    return NextResponse.json({
      success: true,
      action: recommendations.some((item) => item.action === 'BUY')
        ? 'OPPORTUNITIES_FOUND'
        : 'WATCH',
      market: result.market,
      recommendations,
      scanSummary: {
        symbolsScanned: symbols,
        contractsScanned: result.contractsScanned,
        qualifiedContracts: result.qualifiedContracts,
      },
      message: recommendations.some((item) => item.action === 'BUY')
        ? 'وجد فهد فرص أوبشن متوافقة مع اتجاه السوق وجودة العقد.'
        : 'وجد فهد عقودًا جيدة، لكن الدخول يحتاج تأكيدًا إضافيًا.',
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      {
        success: false,
        error: 'FAHD_RECOMMENDATIONS_FAILED',
        message,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'Fahd Options Recommendations V1',
    method: 'POST',
    defaults: {
      symbols: DEFAULT_SYMBOLS,
      timeframe: '15min',
      maxRiskUsd: 100,
      maxResults: 2,
      maxDte: 7,
    },
  });
}
