import assert from "node:assert/strict";
import test from "node:test";

import { compactMessagesForSynthesis } from "../lib/fahd/synthesis-context";

test("keeps tool_use paired with tool_result", () => {
  const messages = [
    { role: "user", content: "ابحث عن فرص" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "tool-1", name: "scan", input: {} }],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: JSON.stringify({ status: "NO_MATCH", contractsScanned: 5100 }),
        },
      ],
    },
  ];

  const compacted = compactMessagesForSynthesis(messages, { maxMessages: 1 });
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0].role, "assistant");
  assert.equal(compacted[1].role, "user");
});

test("compacts a very large tool result while retaining decision fields", () => {
  const hugeContracts = Array.from({ length: 5100 }, (_, index) => ({
    symbol: `SPXW-${index}`,
    score: index % 100,
  }));

  const compacted = compactMessagesForSynthesis(
    [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: JSON.stringify({
              status: "NO_MATCH",
              decision: "WAIT",
              userMessage: "لا توجد فرصة الآن",
              contracts: hugeContracts,
            }),
          },
        ],
      },
    ],
    { maxToolResultChars: 1_000 },
  );

  const block = (compacted[0].content as Array<Record<string, unknown>>)[0];
  const content = String(block.content);
  assert.ok(content.length <= 1_000);
  assert.match(content, /NO_MATCH/);
  assert.match(content, /لا توجد فرصة الآن/);
});

test("uses a smaller payload for the retry profile", () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(2_000),
  }));

  const firstAttempt = compactMessagesForSynthesis(messages, {
    maxMessages: 12,
    maxTextChars: 1_000,
  });
  const retry = compactMessagesForSynthesis(messages, {
    maxMessages: 6,
    maxTextChars: 400,
  });

  assert.ok(JSON.stringify(retry).length < JSON.stringify(firstAttempt).length);
});
