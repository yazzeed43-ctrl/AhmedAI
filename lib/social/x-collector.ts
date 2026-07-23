import {
  parseTelegramSignal,
} from '@/lib/social/telegram';

import {
  saveSocialSignal,
} from '@/lib/social/social-signals';

import {
  fetchNewTweetsForUser,
  parseTwitterApiIoDate,
} from '@/lib/social/x-provider';

import {
  getTrustedXSource,
  listTrustedXSources,
} from '@/lib/social/trusted-x-sources';

export type XIgnoreReason =
  | 'UNTRUSTED_SOURCE'
  | 'INVALID_DATE'
  | 'NO_SYMBOLS'
  | 'DUPLICATE_OR_SAVE_REJECTED';

export type XIgnoredSample = {
  tweetId: string;
  source: string;
  reason: XIgnoreReason;
  text: string;
};

export type XCollectorResult = {
  checkedSources: number;
  fetchedTweets: number;
  savedSignals: number;
  ignoredTweets: number;
  ignoredReasons: Record<XIgnoreReason, number>;
  ignoredSamples: XIgnoredSample[];
  failedSources: string[];
};

function normalizeContentTypes(
  contentTypes: string[],
  sourceCategory: string
): string[] {
  const normalized = new Set(
    contentTypes.map((type) =>
      type.trim().toUpperCase()
    )
  );

  if (sourceCategory === 'OPTIONS_FLOW') {
    normalized.add('WHALE');
  }

  return [...normalized];
}

function normalizeMarketImpact(
  marketImpact: string,
  sourceCategory: string
): string {
  if (
    sourceCategory === 'OPTIONS_FLOW' &&
    marketImpact === 'HIGH'
  ) {
    return 'MEDIUM';
  }

  return marketImpact;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}

function compactTweetText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function recordIgnoredTweet(
  result: XCollectorResult,
  params: {
    tweetId: string;
    source: string;
    reason: XIgnoreReason;
    text: string;
  }
): void {
  result.ignoredTweets += 1;
  result.ignoredReasons[params.reason] += 1;

  if (result.ignoredSamples.length < 8) {
    result.ignoredSamples.push({
      tweetId: params.tweetId,
      source: params.source,
      reason: params.reason,
      text: compactTweetText(params.text),
    });
  }
}

export async function collectTrustedXSignals(params?: {
  windowSeconds?: number;
}): Promise<XCollectorResult> {
  const windowSeconds = Math.max(
    60,
    Math.min(params?.windowSeconds ?? 130, 600)
  );

  const untilUnixSeconds = Math.floor(
    Date.now() / 1000
  );

  const sinceUnixSeconds =
    untilUnixSeconds - windowSeconds;

  const sources = listTrustedXSources();

  const result: XCollectorResult = {
    checkedSources: sources.length,
    fetchedTweets: 0,
    savedSignals: 0,
    ignoredTweets: 0,
    ignoredReasons: {
      UNTRUSTED_SOURCE: 0,
      INVALID_DATE: 0,
      NO_SYMBOLS: 0,
      DUPLICATE_OR_SAVE_REJECTED: 0,
    },
    ignoredSamples: [],
    failedSources: [],
  };

  for (
    let sourceIndex = 0;
    sourceIndex < sources.length;
    sourceIndex += 1
  ) {
    const configuredSource = sources[sourceIndex];

    try {
      const tweets =
        await fetchNewTweetsForUser({
          username: configuredSource.username,
          sinceUnixSeconds,
          untilUnixSeconds,
        });

      result.fetchedTweets += tweets.length;

      for (const tweet of tweets) {
        const source =
          tweet.authorUsername ||
          configuredSource.username;

        const trustedSource =
          getTrustedXSource(
            tweet.authorUsername
          );

        if (!trustedSource) {
          recordIgnoredTweet(result, {
            tweetId: tweet.id,
            source,
            reason: 'UNTRUSTED_SOURCE',
            text: tweet.text,
          });
          continue;
        }

        const publishedAt =
          parseTwitterApiIoDate(
            tweet.createdAt
          );

        if (!publishedAt) {
          recordIgnoredTweet(result, {
            tweetId: tweet.id,
            source,
            reason: 'INVALID_DATE',
            text: tweet.text,
          });
          continue;
        }

        const parsed =
          parseTelegramSignal(
            tweet.text
          );

        if (parsed.symbols.length === 0) {
          recordIgnoredTweet(result, {
            tweetId: tweet.id,
            source,
            reason: 'NO_SYMBOLS',
            text: tweet.text,
          });
          continue;
        }

        const contentTypes =
          normalizeContentTypes(
            parsed.contentTypes,
            trustedSource.category
          );

        const marketImpact =
          normalizeMarketImpact(
            parsed.marketImpact,
            trustedSource.category
          );

        const saved =
          await saveSocialSignal({
            platform: 'x',
            sourceName:
              `@${trustedSource.username}`,
            sourceId:
              trustedSource.username,
            messageId: tweet.id,
            symbol: parsed.symbol,
            symbols: parsed.symbols,
            content: tweet.text,
            contentType:
              parsed.contentType,
            contentTypes,
            marketImpact,
            signalType:
              parsed.signalType,
            sentiment:
              parsed.sentiment,
            confidence:
              parsed.confidence,
            reliabilityScore:
              trustedSource.reliabilityScore,
            publishedAt:
              publishedAt.toISOString(),
            rawData: {
              provider:
                'twitterapi.io',
              tweetId: tweet.id,
              authorUsername:
                tweet.authorUsername,
              sourceCategory:
                trustedSource.category,
              reliabilityScore:
                trustedSource.reliabilityScore,
              collectedAt:
                new Date().toISOString(),
            },
          });

        if (saved) {
          result.savedSignals += 1;
        } else {
          recordIgnoredTweet(result, {
            tweetId: tweet.id,
            source,
            reason:
              'DUPLICATE_OR_SAVE_REJECTED',
            text: tweet.text,
          });
        }
      }
    } catch (error: unknown) {
      result.failedSources.push(
        configuredSource.username
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `X source failed: ${configuredSource.username} error=${message}`
      );
    }

    const hasAnotherSource =
      sourceIndex < sources.length - 1;

    if (hasAnotherSource) {
      await sleep(5_500);
    }
  }

  return result;
}