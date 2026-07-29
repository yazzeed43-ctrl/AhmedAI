import test from "node:test";
import assert from "node:assert/strict";
import {
  compactMessagesForSynthesis,
  compactToolResultContent,
  compactToolResultsForSynthesis,
  estimateMessageChars,
  SYNTHESIS_TIMEOUT_ATTEMPTS_MS,
} from "../lib/fahd/synthesis-context";

function buildLargeResult() {
  return {
    decision: "لا توجد فرصة الآن",
    contractsScanned: 5100,
    contractsAccepted: 0,
    contracts: Array.from({ length: 5100 }, (_, index) => ({
      symbol: `TEST${index}`,
      passedFilter: false,
      score: index % 100,
      reason: `سبب رفض تفصيلي ${index}`,
    })),
    rejectionReasons: ["سيولة", "اتجاه", "جودة", "سعر"],
    dataStatus: { freshness: "live", updatedAt: "2026-07-29T10:00:00Z" },
  };
}

test("compacts large tool output to at most three array entries", () => {
  const compacted = JSON.parse(compactToolResultContent(JSON.stringify(buildLargeResult())));
  assert.equal(compacted.contractsScanned, 5100);
  assert.equal(compacted.contracts.length, 3);
  assert.equal(compacted.rejectionReasons.length, 3);
});

test("retry payload uses one array entry and drops rejection details", () => {
  const compacted = JSON.parse(
    compactToolResultContent(JSON.stringify(buildLargeResult()), { reduced: true }),
  );
  assert.equal(compacted.contracts.length, 1);
  assert.equal("rejectionReasons" in compacted, false);
});

test("compacts tool_result blocks without mutating original results", () => {
  const original = [
    {
      type: "tool_result",
      tool_use_id: "tool-1",
      content: JSON.stringify(buildLargeResult()),
    },
  ];
  const before = original[0].content;
  const compacted = compactToolResultsForSynthesis(original);
  assert.equal(original[0].content, before);
  assert.ok(compacted[0].content.length < before.length);
});

test("second synthesis attempt is smaller than first", () => {
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: JSON.stringify(buildLargeResult()),
        },
      ],
    },
  ];
  const first = compactMessagesForSynthesis(messages);
  const retry = compactMessagesForSynthesis(messages, { reduced: true });
  assert.ok(estimateMessageChars(retry) < estimateMessageChars(first));
});

test("uses moderate timeouts after context reduction", () => {
  assert.deepEqual([...SYNTHESIS_TIMEOUT_ATTEMPTS_MS], [25_000, 20_000]);
});
