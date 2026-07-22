// lib/social/x-provider.ts
const TWITTERAPI_IO_BASE = 'https://api.twitterapi.io';
const ADVANCED_SEARCH_PATH = '/twitter/tweet/advanced_search';

export interface XProviderTweet {
  id: string;
  text: string;
  createdAt: string;
  authorUsername: string;
}

interface RawTwitterApiIoAuthor {
  userName?: string;
}

interface RawTwitterApiIoTweet {
  id?: string;
  text?: string;
  createdAt?: string;
  author?: RawTwitterApiIoAuthor;
  isReply?: boolean;
}

interface RawTwitterApiIoSearchResponse {
  tweets?: RawTwitterApiIoTweet[];
}

function getApiKey(): string {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) throw new Error('TWITTERAPI_IO_KEY غير موجود بمتغيرات البيئة');
  return key;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUsableTweet(
  tweet: RawTwitterApiIoTweet
): tweet is RawTwitterApiIoTweet & { id: string; text: string; createdAt: string } {
  return (
    typeof tweet.id === 'string' &&
    typeof tweet.text === 'string' &&
    typeof tweet.createdAt === 'string' &&
    tweet.isReply !== true
  );
}

export async function fetchNewTweetsForUser(params: {
  username: string;
  sinceUnixSeconds: number;
  untilUnixSeconds: number;
}): Promise<XProviderTweet[]> {
  const { username, sinceUnixSeconds, untilUnixSeconds } = params;

  if (
    !Number.isFinite(sinceUnixSeconds) ||
    !Number.isFinite(untilUnixSeconds) ||
    sinceUnixSeconds < 0 ||
    untilUnixSeconds <= sinceUnixSeconds
  ) {
    throw new Error('نافذة TwitterAPI.io الزمنية غير صالحة');
  }

  const query =
    `from:${username} -filter:replies ` +
    `since_time:${sinceUnixSeconds} ` +
    `until_time:${untilUnixSeconds}`;

  const url = new URL(`${TWITTERAPI_IO_BASE}${ADVANCED_SEARCH_PATH}`);
  url.searchParams.set('query', query);
  url.searchParams.set('queryType', 'Latest');

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: { 'X-API-Key': getApiKey() },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error: unknown) {
    console.error(
      `TwitterAPI.io fetch threw: query="${query}" error=${errorMessage(error)}`
    );
    return [];
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    console.error(
      `TwitterAPI.io HTTP error: query="${query}" status=${response.status} body=${bodyText}`
    );
    return [];
  }

  let data: RawTwitterApiIoSearchResponse;

  try {
    data = await response.json();
  } catch (error: unknown) {
    console.error(
      `TwitterAPI.io response JSON parse failed: query="${query}" error=${errorMessage(error)}`
    );
    return [];
  }

  const rawTweets = Array.isArray(data.tweets) ? data.tweets : [];
  const uniqueTweets = new Map<string, XProviderTweet>();

  for (const tweet of rawTweets) {
    if (!isUsableTweet(tweet)) continue;

    const text = tweet.text.trim();
    if (!text) continue;

    uniqueTweets.set(tweet.id, {
      id: tweet.id,
      text,
      createdAt: tweet.createdAt,
      authorUsername: tweet.author?.userName?.trim() || username,
    });
  }

  return [...uniqueTweets.values()];
}

export function parseTwitterApiIoDate(createdAt: string): Date | null {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
