/**
 * cerebras.ts — Cerebras Client & Response Generation Helper
 *
 * Wraps the Cerebras Cloud SDK to generate a single response for a
 * conversation dialog. The system prompt includes RAG context retrieved
 * from Elasticsearch so the response is grounded in the person's real data.
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
 * generateResponse — produces a single response for a dialog using Cerebras.
 *
 * @param systemPrompt  The system-level instruction (includes RAG context
 *                      retrieved from Elasticsearch).
 * @param dialog        The conversation history as an array of messages.
 * @returns             A single response string.
 */
export async function generateResponse(
  systemPrompt: string,
  dialog: DialogMessage[]
): Promise<string> {
  const messages = toCerebrasMessages([
    { role: "system", content: systemPrompt },
    ...dialog,
  ]);

  const params: ChatCompletionCreateParamsNonStreaming = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 0.7,
    max_tokens: 512,
  };

  const response = (await client.chat.completions.create(
    params
  )) as ChatCompletion.ChatCompletionResponse;

  return response.choices[0]?.message?.content ?? "(no response generated)";
}
