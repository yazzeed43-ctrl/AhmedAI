const TELEGRAM_MESSAGE_LIMIT = 4096;
const SAFE_TELEGRAM_CHUNK_SIZE = 3900;

export interface TelegramSendResult {
  messageId: number;
}

export type TelegramFailureKind = "DEFINITIVE" | "DELIVERY_UNKNOWN";

export class TelegramDeliveryError extends Error {
  constructor(
    message: string,
    public readonly deliveredMessageIds: number[],
    public readonly failureKind: TelegramFailureKind,
  ) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

function splitTelegramText(text: string): string[] {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > SAFE_TELEGRAM_CHUNK_SIZE) {
    const candidate = remaining.slice(0, SAFE_TELEGRAM_CHUNK_SIZE);
    const newline = candidate.lastIndexOf("\n");
    const splitAt = newline > SAFE_TELEGRAM_CHUNK_SIZE / 2
      ? newline + 1
      : SAFE_TELEGRAM_CHUNK_SIZE;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendTelegramText(options: {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<TelegramSendResult[]> {
  const token = options.token.trim();
  const chatId = options.chatId.trim();
  const text = options.text.trim();

  if (!token || !chatId || !text) {
    throw new Error("Telegram token, chat ID, and text are required");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const results: TelegramSendResult[] = [];

  for (const chunk of splitTelegramText(text)) {
    let delivered = false;
    for (let attempt = 1; attempt <= 3 && !delivered; attempt += 1) {
      let response: Response;
      let body: any = null;
      try {
        response = await fetchImpl(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: chunk }),
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
          },
        );
        body = await response.json().catch(() => null);
      } catch (error) {
        if (attempt < 3) {
          await sleep(250 * attempt);
          continue;
        }
        throw new TelegramDeliveryError(
          error instanceof Error ? error.message : "Telegram network request failed",
          results.map((item) => item.messageId),
          "DELIVERY_UNKNOWN",
        );
      }

      if (response.ok && body?.ok && body?.result?.message_id) {
        results.push({ messageId: Number(body.result.message_id) });
        delivered = true;
        continue;
      }

      const retryable = response.status === 429 || [502, 503, 504].includes(response.status);
      if (retryable && attempt < 3) {
        const retryAfterSeconds = Number(body?.parameters?.retry_after);
        const delay = response.status === 429 && Number.isFinite(retryAfterSeconds)
          ? Math.max(0, Math.min(retryAfterSeconds * 1000, 10_000))
          : 250 * attempt;
        await sleep(delay);
        continue;
      }

      throw new TelegramDeliveryError(
        `Telegram sendMessage failed with HTTP ${response.status}`,
        results.map((item) => item.messageId),
        "DEFINITIVE",
      );
    }
  }

  return results;
}
