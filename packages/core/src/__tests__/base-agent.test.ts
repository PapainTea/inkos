import { afterEach, describe, expect, it, vi } from "vitest";
import * as providerModule from "../llm/provider.js";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import type { LLMMessage } from "../llm/provider.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

class TestAgent extends BaseAgent {
  get name(): string {
    return "test-agent";
  }

  async runChatWithSearch(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ) {
    return this.chatWithSearch(messages, options);
  }
}

describe("BaseAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards onStreamToken when OpenAI chatWithSearch uses native web search", async () => {
    const onStreamProgress = vi.fn();
    const onStreamToken = vi.fn();
    const chatCompletionSpy = vi.spyOn(providerModule, "chatCompletion").mockResolvedValue({
      content: "ok",
      usage: ZERO_USAGE,
    });

    const ctx: AgentContext = {
      client: {
        provider: "openai",
        apiFormat: "responses",
        stream: true,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
          maxTokensCap: null,
          extra: {},
        },
      } as AgentContext["client"],
      model: "test-model",
      projectRoot: process.cwd(),
      onStreamProgress,
      onStreamToken,
    };
    const agent = new TestAgent(ctx);
    const messages: ReadonlyArray<LLMMessage> = [{ role: "user", content: "search for clues" }];

    await agent.runChatWithSearch(messages, { temperature: 0.2, maxTokens: 1234 });

    expect(chatCompletionSpy).toHaveBeenCalledWith(
      ctx.client,
      ctx.model,
      messages,
      expect.objectContaining({
        temperature: 0.2,
        maxTokens: 1234,
        webSearch: true,
        onStreamProgress,
        onStreamToken,
      }),
    );
  });
});
