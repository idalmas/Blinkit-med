/**
 * cerebras.ts — Cerebras Client & Two-Response Generation Helper
 *
 * Wraps the Cerebras Cloud SDK to generate two distinct response options for a
 * conversation dialog. We call chat completions twice with different
 * temperature / seed combos so the user gets meaningfully different replies.
 *
 * Used by: routes/generate.ts
 *
 * Requires env var:
 *   - CEREBRAS_API_KEY
 */

import Cerebras from "@cerebras/cerebras_cloud_sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
} from "@cerebras/cerebras_cloud_sdk/resources/chat/completions";

const apiKey = process.env.CEREBRAS_API_KEY;

if (!apiKey) {
  throw new Error(
    "Missing CEREBRAS_API_KEY environment variable. " +
      "Copy .env.example to .env and fill in your values."
  );
}

const client = new Cerebras({ apiKey });

/** The Cerebras model to use for generation. */
const MODEL = "llama3.1-8b";

/**
 * The Cerebras SDK message type — a union of system / user / assistant / tool
 * message request shapes.
 */
type CerebrasMessage = NonNullable<ChatCompletionCreateParams["messages"]>[number];

/** Shape of a single message in the dialog array (our simplified version). */
export interface DialogMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * toCerebrasMessages — converts our DialogMessage[] to the SDK's expected
 * discriminated-union message format.
 *
 * @param msgs  Array of simplified dialog messages.
 * @returns     Array of Cerebras-typed messages.
 */
function toCerebrasMessages(msgs: DialogMessage[]): CerebrasMessage[] {
  return msgs.map((m) => {
    switch (m.role) {
      case "system":
        return { role: "system" as const, content: m.content };
      case "user":
        return { role: "user" as const, content: m.content };
      case "assistant":
        return { role: "assistant" as const, content: m.content };
    }
  });
}

/**
 * generateTwoOptions — produces two distinct response options for a dialog.
 *
 * @param systemPrompt  The system-level instruction (includes RAG context).
 * @param dialog        The conversation history as an array of messages.
 * @returns             A tuple of two response strings [optionA, optionB].
 */
export async function generateTwoOptions(
  systemPrompt: string,
  dialog: DialogMessage[]
): Promise<[string, string]> {
  const messages = toCerebrasMessages([
    { role: "system", content: systemPrompt },
    ...dialog,
  ]);

  const paramsA: ChatCompletionCreateParamsNonStreaming = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.7,
    seed: 42,
    max_tokens: 512,
  };

  const paramsB: ChatCompletionCreateParamsNonStreaming = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.9,
    seed: 123,
    max_tokens: 512,
  };

  // Fire both requests in parallel for speed.
  // Cast to ChatCompletionResponse since we set stream: false.
  const [responseA, responseB] = await Promise.all([
    client.chat.completions.create(paramsA) as Promise<ChatCompletion.ChatCompletionResponse>,
    client.chat.completions.create(paramsB) as Promise<ChatCompletion.ChatCompletionResponse>,
  ]);

  const optionA =
    responseA.choices[0]?.message?.content ?? "(no response generated)";
  const optionB =
    responseB.choices[0]?.message?.content ?? "(no response generated)";

  return [optionA, optionB];
}
