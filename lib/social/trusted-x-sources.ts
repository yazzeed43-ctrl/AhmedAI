export type XSourceCategory =
  | 'OFFICIAL_IR'
  | 'NEWS_WIRE'
  | 'OPTIONS_FLOW'
  | 'ESTIMATE_PROVIDER'
  | 'MACRO';

export type TrustedXSource = {
  username: string;
  category: XSourceCategory;
  reliabilityScore: number;
};

export const TRUSTED_X_SOURCES: Record<string, TrustedXSource> = {
  DeItaone: {
    username: 'DeItaone',
    category: 'NEWS_WIRE',
    reliabilityScore: 0.95,
  },
  WalterBloomberg: {
    username: 'WalterBloomberg',
    category: 'NEWS_WIRE',
    reliabilityScore: 0.9,
  },
  FinancialJuice: {
    username: 'FinancialJuice',
    category: 'NEWS_WIRE',
    reliabilityScore: 0.9,
  },
  SEC_News: {
    username: 'SEC_News',
    category: 'OFFICIAL_IR',
    reliabilityScore: 1,
  },
  EarningsWhispers: {
    username: 'EarningsWhispers',
    category: 'ESTIMATE_PROVIDER',
    reliabilityScore: 0.8,
  },
  UnusualWhales: {
    username: 'UnusualWhales',
    category: 'OPTIONS_FLOW',
    reliabilityScore: 0.85,
  },
};

export function normalizeXUsername(username: string): string {
  return username.trim().replace(/^@/, '').toLowerCase();
}

const trustedByNormalizedUsername = new Map(
  Object.values(TRUSTED_X_SOURCES).map((source) => [
    normalizeXUsername(source.username),
    source,
  ])
);

export function getTrustedXSource(
  username: string
): TrustedXSource | null {
  return (
    trustedByNormalizedUsername.get(
      normalizeXUsername(username)
    ) ?? null
  );
}

export function listTrustedXSources(): TrustedXSource[] {
  return Object.values(TRUSTED_X_SOURCES);
}
