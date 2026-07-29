export const SYNTHESIS_TIMEOUT_ATTEMPTS_MS = [25_000, 20_000] as const;

const DROP_ON_RETRY = new Set([
  "rejectionReasons",
  "rejectedContracts",
  "providerErrors",
  "diagnostics",
  "raw",
]);

export type SynthesisCompactOptions = {
  reduced?: boolean;
};

function compactValue(
  value: unknown,
  options: SynthesisCompactOptions,
  depth = 0,
): unknown {
  const reduced = options.reduced === true;
  const maxArrayItems = reduced ? 1 : 3;
  const maxStringLength = reduced ? 500 : 1_200;

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > maxStringLength
      ? `${value.slice(0, maxStringLength)}…`
      : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= 6) return "[تم اختصار التفاصيل]";

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((item) => compactValue(item, options, depth + 1));
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, nested] of entries) {
    if (reduced && DROP_ON_RETRY.has(key)) continue;
    result[key] = compactValue(nested, options, depth + 1);
  }
  return result;
}

export function compactToolResultContent(
  content: unknown,
  options: SynthesisCompactOptions = {},
): string {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(compactValue(parsed, options));
  } catch {
    const limit = options.reduced ? 500 : 1_200;
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }
}

export function compactToolResultsForSynthesis(
  toolResults: any[],
  options: SynthesisCompactOptions = {},
): any[] {
  return toolResults.map((result) => ({
    ...result,
    content: compactToolResultContent(result?.content, options),
  }));
}

export function compactMessagesForSynthesis(
  messages: any[],
  options: SynthesisCompactOptions = {},
): any[] {
  return messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((block: any) =>
        block?.type === "tool_result"
          ? {
              ...block,
              content: compactToolResultContent(block.content, options),
            }
          : block,
      ),
    };
  });
}

export function estimateMessageChars(messages: any[]): number {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}
