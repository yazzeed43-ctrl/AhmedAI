type ClaudeMessage = {
  role: string;
  content: unknown;
};

type CompactOptions = {
  maxMessages?: number;
  maxTextChars?: number;
  maxToolResultChars?: number;
};

const DEFAULT_OPTIONS: Required<CompactOptions> = {
  maxMessages: 12,
  maxTextChars: 6_000,
  maxToolResultChars: 9_000,
};

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 80))}\n...[تم اختصار السياق لتسريع الصياغة]`;
}

function compactJsonValue(value: unknown, maxChars: number): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.length <= maxChars) return serialized;

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object") {
      const source = parsed as Record<string, unknown>;
      const compact = {
        status: source.status,
        decision: source.decision,
        finalDecision: source.finalDecision,
        recommendation: source.recommendation,
        userMessage: source.userMessage,

        marketScore: source.marketScore,
        stockScore: source.stockScore,
        optionsScore: source.optionsScore,
        tradeScore: source.tradeScore,
        finalScore: source.finalScore,
        confidence: source.confidence,
        bias: source.bias,
        probabilities: source.probabilities,

        scan: source.scan,
        trigger: source.trigger,
        optionQuality: source.optionQuality,
        economicGate: source.economicGate,
        dataStatus: source.dataStatus,

        opportunity: source.opportunity,
        contract: source.contract,
        selectedContract: source.selectedContract,
        opportunities: Array.isArray(source.opportunities)
          ? source.opportunities.slice(0, 2)
          : undefined,
        results: Array.isArray(source.results) ? source.results.slice(0, 2) : undefined,
        candidates: Array.isArray(source.candidates)
          ? source.candidates.slice(0, 2)
          : undefined,

        summary: source.summary,
        reasons: Array.isArray(source.reasons) ? source.reasons.slice(0, 8) : source.reasons,
        warnings: Array.isArray(source.warnings)
          ? source.warnings.slice(0, 8)
          : source.warnings,
        error: source.error,
      };
      const compactSerialized = JSON.stringify(compact);
      if (compactSerialized.length <= maxChars) return compactSerialized;
      return truncateText(compactSerialized, maxChars);
    }
  } catch {
    // المحتوى ليس JSON صالحًا؛ نختصره كنص.
  }

  return truncateText(serialized, maxChars);
}

function compactContent(content: unknown, options: Required<CompactOptions>): unknown {
  if (typeof content === "string") {
    return truncateText(content, options.maxTextChars);
  }

  if (!Array.isArray(content)) return content;

  return content.map((block) => {
    if (!block || typeof block !== "object") return block;
    const typedBlock = block as Record<string, unknown>;

    if (typedBlock.type === "text" && typeof typedBlock.text === "string") {
      return {
        ...typedBlock,
        text: truncateText(typedBlock.text, options.maxTextChars),
      };
    }

    if (typedBlock.type === "tool_result") {
      return {
        ...typedBlock,
        content: compactJsonValue(
          typedBlock.content,
          options.maxToolResultChars,
        ),
      };
    }

    return block;
  });
}

/**
 * يقلل سياق Anthropic بدون حذف آخر تسلسل tool_use/tool_result، حتى تبقى
 * صياغة النتيجة مبنية على المخرجات البرمجية الفعلية ولا تعيد تشغيل الأدوات.
 */
export function compactMessagesForSynthesis(
  messages: ClaudeMessage[],
  options: CompactOptions = {},
): ClaudeMessage[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const startIndex = Math.max(0, messages.length - resolved.maxMessages);

  // لا نبدأ من tool_result منفصل عن رسالة assistant التي تحتوي tool_use.
  let safeStartIndex = startIndex;
  const candidate = messages[safeStartIndex];
  if (
    candidate?.role === "user" &&
    Array.isArray(candidate.content) &&
    candidate.content.some(
      (block) =>
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "tool_result",
    ) &&
    safeStartIndex > 0
  ) {
    safeStartIndex -= 1;
  }

  return messages.slice(safeStartIndex).map((message) => ({
    ...message,
    content: compactContent(message.content, resolved),
  }));
}