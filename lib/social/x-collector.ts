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

export type XCollectorResult = {
  checkedSources: number;
  fetchedTweets: number;
  savedSignals: number;
  ignoredTweets: number;
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
  // تدفقات الخيارات تعتبر دليلًا سوقيًا،
  // وليست حدثًا رسميًا يفرض HIGH بمفرده.
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
        const trustedSource =
          getTrustedXSource(
            tweet.authorUsername
          );

        if (!trustedSource) {
          result.ignoredTweets += 1;
          continue;
        }

        const publishedAt =
          parseTwitterApiIoDate(
            tweet.createdAt
          );

        if (!publishedAt) {
          result.ignoredTweets += 1;
          continue;
        }

        const parsed =
          parseTelegramSignal(
            tweet.text
          );

        if (parsed.symbols.length === 0) {
          result.ignoredTweets += 1;
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
          result.ignoredTweets += 1;
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
      // حساب TwitterAPI.io المجاني يسمح
      // بطلب واحد فقط كل 5 ثوانٍ.
      await sleep(5_500);
    }
  }

  return result;
}