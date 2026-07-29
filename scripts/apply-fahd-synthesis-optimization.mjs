import fs from "node:fs";

const path = "app/api/fahd-chat/route.ts";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Patch marker not found: ${label}`);
  }
  source = source.replace(search, replacement);
}

if (!source.includes('from "@/lib/fahd/synthesis-context"')) {
  replaceOnce(
    'import { buildFahdResponse } from "@/lib/fahd/compact-response";\n',
    'import { buildFahdResponse } from "@/lib/fahd/compact-response";\nimport {\n  compactMessagesForSynthesis,\n  compactToolResultsForSynthesis,\n  estimateMessageChars,\n  SYNTHESIS_TIMEOUT_ATTEMPTS_MS,\n} from "@/lib/fahd/synthesis-context";\n',
    "synthesis context import",
  );
}

source = source.replace(
  'const FAHD_MODEL_TIMEOUT_ATTEMPTS_MS = [18_000, 15_000] as const;\n',
  '',
);

const oldRequestInit = `  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system,
      tools: TOOLS,
      messages,
    }),
  };
`;

const newRequestInit = `  const buildRequestInit = (attemptMessages: any[]): RequestInit => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system,
      tools: TOOLS,
      messages: attemptMessages,
    }),
  });
`;

if (source.includes(oldRequestInit)) {
  replaceOnce(oldRequestInit, newRequestInit, "dynamic Anthropic request body");
}

source = source.replaceAll(
  "FAHD_MODEL_TIMEOUT_ATTEMPTS_MS",
  "SYNTHESIS_TIMEOUT_ATTEMPTS_MS",
);

const oldTry = `    try {
      response = await fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        requestInit,
        attemptTimeoutMs,
      );
`;
const newTry = `    const attemptMessages = compactMessagesForSynthesis(messages, {
      reduced: attempt > 0,
    });
    console.info("Anthropic synthesis request context:", {
      attempt: attempt + 1,
      reduced: attempt > 0,
      messageChars: estimateMessageChars(attemptMessages),
      timeoutMs: attemptTimeoutMs,
    });

    try {
      response = await fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        buildRequestInit(attemptMessages),
        attemptTimeoutMs,
      );
`;
if (source.includes(oldTry)) {
  replaceOnce(oldTry, newTry, "smart retry request payload");
}

const oldPush = '      workingMessages.push({ role: "user", content: toolResults });';
const newPush = `      workingMessages.push({
        role: "user",
        content: compactToolResultsForSynthesis(toolResults),
      });`;
if (source.includes(oldPush)) {
  replaceOnce(oldPush, newPush, "tool result compaction");
}

if (!source.includes("compactToolResultsForSynthesis(toolResults)")) {
  throw new Error("Tool result compaction was not applied");
}
if (!source.includes("buildRequestInit(attemptMessages)")) {
  throw new Error("Smart retry payload was not applied");
}

fs.writeFileSync(path, source);
console.log("Applied Fahd synthesis context optimization to route.ts");
