import {
  formatUnifiedPremarketWatchlist,
  scanUnifiedPremarketUniverse,
} from "./unified-premarket-scanner";
import { TelegramDeliveryError } from "../notifications/telegram-sender";
import { createHash } from "node:crypto";
import type { MarketSessionCheck } from "./market-session-calendar";
import type { PremarketClaimResult } from "./premarket-delivery-store";

export type PremarketCronOutcome =
  | "SENT"
  | "SKIPPED_OUTSIDE_WINDOW"
  | "SKIPPED_HOLIDAY"
  | "SKIPPED_SESSION_UNVERIFIED"
  | "SKIPPED_ALREADY_SENT"
  | "SKIPPED_IN_PROGRESS"
  | "PARTIAL_REQUIRES_RECONCILIATION"
  | "PARTIAL_DELIVERY"
  | "DELIVERY_UNCONFIRMED";

export interface PremarketCronDependencies {
  checkMarketSession: (sessionDate: string) => Promise<MarketSessionCheck>;
  claimSession: (sessionDate: string, now: Date) => Promise<PremarketClaimResult>;
  saveSessionReport: (
    sessionDate: string,
    reportJson: unknown,
    formattedMessage: string,
    reportHash: string,
  ) => Promise<void>;
  markSessionFailed: (sessionDate: string, code: string, message: string) => Promise<void>;
  markSessionPartial: (sessionDate: string, messageIds: number[], message: string) => Promise<void>;
  markSessionDeliveryStarted: (sessionDate: string) => Promise<void>;
  markSessionDeliveryUnconfirmed: (
    sessionDate: string,
    messageIds: number[],
    message: string,
  ) => Promise<void>;
  markSessionSent: (sessionDate: string, messageIds: number[]) => Promise<void>;
  scan: typeof scanUnifiedPremarketUniverse;
  format: typeof formatUnifiedPremarketWatchlist;
  send: (text: string) => Promise<Array<{ messageId: number }>>;
}

export function getNewYorkPremarketWindow(now: Date): {
  sessionDate: string;
  weekday: string;
  hour: number;
  minute: number;
  shouldRun: boolean;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  const sessionDate = `${value("year")}-${value("month")}-${value("day")}`;
  const isWeekday = !["Sat", "Sun"].includes(weekday);

  return {
    sessionDate,
    weekday,
    hour,
    minute,
    shouldRun: isWeekday && hour === 8,
  };
}

export async function executePremarketCron(options: {
  now?: Date;
  dependencies: PremarketCronDependencies;
}): Promise<{
  outcome: PremarketCronOutcome;
  sessionDate: string;
  messageIds: number[];
  reason?: string;
  stockDataStatus?: string;
  stockOutcome?: string;
  spxwStatus?: string;
}> {
  const window = getNewYorkPremarketWindow(options.now ?? new Date());

  if (!window.shouldRun) {
    return {
      outcome: "SKIPPED_OUTSIDE_WINDOW",
      sessionDate: window.sessionDate,
      messageIds: [],
    };
  }

  const session = await options.dependencies.checkMarketSession(window.sessionDate);
  if (session.status === "HOLIDAY") {
    return {
      outcome: "SKIPPED_HOLIDAY",
      sessionDate: window.sessionDate,
      messageIds: [],
      reason: session.reason,
    };
  }
  if (session.status === "UNAVAILABLE") {
    return {
      outcome: "SKIPPED_SESSION_UNVERIFIED",
      sessionDate: window.sessionDate,
      messageIds: [],
      reason: session.reason,
    };
  }

  const claim = await options.dependencies.claimSession(
    window.sessionDate,
    options.now ?? new Date(),
  );
  const claimOutcomes: Partial<Record<PremarketClaimResult, PremarketCronOutcome>> = {
    ALREADY_SENT: "SKIPPED_ALREADY_SENT",
    IN_PROGRESS: "SKIPPED_IN_PROGRESS",
    PARTIAL_REQUIRES_RECONCILIATION: "PARTIAL_REQUIRES_RECONCILIATION",
  };
  const claimOutcome = claimOutcomes[claim];
  if (claimOutcome) {
    return { outcome: claimOutcome, sessionDate: window.sessionDate, messageIds: [] };
  }

  try {
    const result = await options.dependencies.scan();
    const text = options.dependencies.format(result);
    const reportHash = createHash("sha256").update(text).digest("hex");
    await options.dependencies.saveSessionReport(
      window.sessionDate,
      result,
      text,
      reportHash,
    );
    await options.dependencies.markSessionDeliveryStarted(window.sessionDate);
    const sent = await options.dependencies.send(text);
    const messageIds = sent.map((item) => item.messageId);
    try {
      await options.dependencies.markSessionSent(window.sessionDate, messageIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery ledger confirmation failed";
      await options.dependencies.markSessionDeliveryUnconfirmed(
        window.sessionDate,
        messageIds,
        message,
      ).catch(() => undefined);
      return {
        outcome: "DELIVERY_UNCONFIRMED",
        sessionDate: window.sessionDate,
        messageIds,
        reason: message,
      };
    }

    return {
      outcome: "SENT",
      sessionDate: window.sessionDate,
      messageIds,
      stockDataStatus: result.stockScan.dataStatus,
      stockOutcome: result.stockScan.outcome,
      spxwStatus: result.spxwScan.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Premarket delivery failed";
    if (
      error instanceof TelegramDeliveryError &&
      error.failureKind === "DELIVERY_UNKNOWN"
    ) {
      await options.dependencies.markSessionDeliveryUnconfirmed(
        window.sessionDate,
        error.deliveredMessageIds,
        message,
      ).catch(() => undefined);
      return {
        outcome: "DELIVERY_UNCONFIRMED",
        sessionDate: window.sessionDate,
        messageIds: error.deliveredMessageIds,
        reason: message,
      };
    }
    if (error instanceof TelegramDeliveryError && error.deliveredMessageIds.length > 0) {
      await options.dependencies.markSessionPartial(
        window.sessionDate,
        error.deliveredMessageIds,
        message,
      );
      return {
        outcome: "PARTIAL_DELIVERY",
        sessionDate: window.sessionDate,
        messageIds: error.deliveredMessageIds,
        reason: message,
      };
    }
    if (!(error instanceof TelegramDeliveryError && error.deliveredMessageIds.length > 0)) {
      await options.dependencies.markSessionFailed(
        window.sessionDate,
        error instanceof TelegramDeliveryError ? "TELEGRAM_DELIVERY_FAILED" : "PREMARKET_RUN_FAILED",
        message,
      ).catch(async () => {
        await options.dependencies.markSessionDeliveryUnconfirmed(
          window.sessionDate,
          [],
          message,
        ).catch(() => undefined);
      });
    }
    throw error;
  }
}
