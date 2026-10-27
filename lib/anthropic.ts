import Anthropic from "@anthropic-ai/sdk";

/** Server-side provider factory shared by the two independent assistants. */
export function createAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 8000 });
}
