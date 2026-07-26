/**
 * normalize-news-headlines.ts
 * تطبيع قائمة العناوين + حساب headlineHash ثابت (لا يتأثر بترتيب الوصول أو الحروف).
 */

import { createHash } from "node:crypto";
import type { RawHeadline } from "./news-modifier-types";

/** مدة الحداثة الافتراضية: 30 دقيقة (قرار يزيد الشريف — صارم، يناسب التداول اللحظي) */
export const DEFAULT_MAX_HEADLINE_AGE_MS = 30 * 60 * 1000;

function parsePublishedAtMs(headline: RawHeadline): number | null {
  if (!headline.publishedAt) return null;
  const parsed = Date.parse(headline.publishedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export type FreshHeadlinesResult = {
  fresh: RawHeadline[];
  /** عناوين لها توقيت صالح لكنها خارج نافذة الحداثة (قديمة جداً أو مستقبلية بشكل مريب) */
  staleCount: number;
  /** عناوين بلا توقيت صالح إطلاقاً — تُرفض دائماً، لا نفترض حداثتها */
  missingTimestampCount: number;
};

/**
 * يفلتر العناوين إلى فئة "حديثة" فقط — أي عنوان بدون publishedAt صالح يُرفض
 * تلقائياً (لا نفترض إنه حديث)، وأي عنوان أقدم من maxAgeMs أو موسوم بتاريخ
 * مستقبلي (احتمال خطأ بيانات) يُستبعد أيضاً.
 */
export function filterFreshHeadlines(
  headlines: RawHeadline[],
  nowMs: number,
  maxAgeMs: number = DEFAULT_MAX_HEADLINE_AGE_MS,
): FreshHeadlinesResult {
  const fresh: RawHeadline[] = [];
  let staleCount = 0;
  let missingTimestampCount = 0;

  for (const headline of headlines) {
    const publishedAtMs = parsePublishedAtMs(headline);
    if (publishedAtMs === null) {
      missingTimestampCount += 1;
      continue;
    }
    const ageMs = nowMs - publishedAtMs;
    if (ageMs < 0 || ageMs > maxAgeMs) {
      staleCount += 1;
      continue;
    }
    fresh.push(headline);
  }

  return { fresh, staleCount, missingTimestampCount };
}

/** تطبيع نص واحد: trim + طي المسافات + توحيد الحالة */
function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePublishedAt(publishedAt: string | undefined): string {
  if (!publishedAt) return "";
  const parsed = Date.parse(publishedAt);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

/**
 * يرجع قائمة العناوين بعد التطبيع والتفريد والترتيب الأبجدي — ثابتة بغض النظر
 * عن ترتيب وصولها من المصدر، حتى يبقى الهاش مستقراً لنفس المجموعة الفعلية.
 */
export function normalizeHeadlineSet(headlines: RawHeadline[]): string[] {
  const normalized = headlines
    .map((h) => normalizeTitle(h.title ?? ""))
    .filter((t) => t.length > 0);

  return Array.from(new Set(normalized)).sort();
}

/**
 * هاش قصير (16 حرف hex) لرمز + مجموعة عناوين مطبَّعة.
 * يتغير فقط عند تغيّر المحتوى الفعلي للأخبار، لا عند إعادة الترتيب أو اختلاف الحالة.
 */
export function computeHeadlineHash(symbol: string, headlines: RawHeadline[]): string {
  const normalizedSet = Array.from(
    new Set(
      headlines
        .map((headline) => {
          const title = normalizeTitle(headline.title ?? "");
          return title
            ? `${title}@${normalizePublishedAt(headline.publishedAt)}`
            : "";
        })
        .filter(Boolean),
    ),
  ).sort();
  const payload = `${symbol.toUpperCase()}::${normalizedSet.join("|")}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
