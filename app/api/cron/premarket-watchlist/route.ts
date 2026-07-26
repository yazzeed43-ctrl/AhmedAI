import { NextRequest, NextResponse } from "next/server";

import { sendTelegramText } from "@/lib/notifications/telegram-sender";
import {
  claimPremarketSession,
  markPremarketSessionDeliveryStarted,
  markPremarketSessionDeliveryUnconfirmed,
  markPremarketSessionFailed,
  markPremarketSessionPartial,
  markPremarketSessionSent,
  savePremarketSessionReport,
} from "@/lib/trading/premarket-delivery-store";
import {
  executePremarketCron,
  getNewYorkPremarketWindow,
} from "@/lib/trading/premarket-cron-service";
import { checkTradierMarketSession } from "@/lib/trading/market-session-calendar";
import {
  formatUnifiedPremarketWatchlist,
  scanUnifiedPremarketUniverse,
} from "@/lib/trading/unified-premarket-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const window = getNewYorkPremarketWindow(now);
  if (!window.shouldRun) {
    return NextResponse.json({
      ok: true,
      outcome: "SKIPPED_OUTSIDE_WINDOW",
      sessionDate: window.sessionDate,
      messageIds: [],
      executedAt: now.toISOString(),
    });
  }

  try {
    const result = await executePremarketCron({
      now,
      dependencies: {
        checkMarketSession: checkTradierMarketSession,
        claimSession: claimPremarketSession,
        saveSessionReport: savePremarketSessionReport,
        markSessionDeliveryStarted: markPremarketSessionDeliveryStarted,
        markSessionDeliveryUnconfirmed: markPremarketSessionDeliveryUnconfirmed,
        markSessionFailed: markPremarketSessionFailed,
        markSessionPartial: markPremarketSessionPartial,
        markSessionSent: markPremarketSessionSent,
        scan: scanUnifiedPremarketUniverse,
        format: formatUnifiedPremarketWatchlist,
        send: (text) => {
          const token = process.env.TELEGRAM_BOT_TOKEN;
          const chatId = process.env.TELEGRAM_PREMARKET_CHAT_ID;
          if (!token || !chatId) {
            throw new Error("Telegram premarket delivery is not configured");
          }
          return sendTelegramText({ token, chatId, text });
        },
      },
    });
    return NextResponse.json({ ok: true, ...result, executedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Premarket cron failed";
    console.error("PREMARKET_WATCHLIST_CRON_FAILED", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
