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

  function makeOpenAICtx(): AgentContext {
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return logger;
      },
    } as unknown as AgentContext["logger"];
    return {
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
      logger,
    };
  }

  const TOOL_UNSUPPORTED_ERRORS = [
    "400 Unsupported tool type: web_search_preview",
    "unsupported tool type 'web_search_preview'",
    "Provider error: web_search_preview not available",
    "Unknown tool type 'web_search_preview' requested",
  ];

  it.each(TOOL_UNSUPPORTED_ERRORS)(
    "falls back to plain chat when OpenAI webSearch raises: %s",
    async (errMsg) => {
      const chatCompletionSpy = vi
        .spyOn(providerModule, "chatCompletion")
        .mockImplementationOnce(async () => {
          throw new Error(errMsg);
        })
        .mockResolvedValueOnce({ content: "plain-ok", usage: ZERO_USAGE });

      const ctx = makeOpenAICtx();
      const agent = new TestAgent(ctx);
      const messages: ReadonlyArray<LLMMessage> = [{ role: "user", content: "hi" }];

      const result = await agent.runChatWithSearch(messages);

      expect(result.content).toBe("plain-ok");
      expect(chatCompletionSpy).toHaveBeenCalledTimes(2);
      // First call should carry webSearch: true
      expect(chatCompletionSpy.mock.calls[0]?.[3]).toMatchObject({ webSearch: true });
      // Second call (fallback) must NOT enable webSearch
      const fallbackOpts = chatCompletionSpy.mock.calls[1]?.[3] as Record<string, unknown>;
      expect(fallbackOpts?.webSearch).not.toBe(true);
    },
  );

  const NON_TOOL_ERRORS = [
    "429 Rate limit exceeded",
    "400 Search rate limit exceeded for today",
    "400 Search query too long: reduce it to 200 chars",
    "401 Invalid API key",
    "500 Internal server error",
  ];

  it.each(NON_TOOL_ERRORS)(
    "does NOT fall back when OpenAI webSearch raises non-tool error: %s",
    async (errMsg) => {
      const chatCompletionSpy = vi
        .spyOn(providerModule, "chatCompletion")
        .mockImplementationOnce(async () => {
          throw new Error(errMsg);
        });

      const ctx = makeOpenAICtx();
      const agent = new TestAgent(ctx);
      const messages: ReadonlyArray<LLMMessage> = [{ role: "user", content: "hi" }];

      await expect(agent.runChatWithSearch(messages)).rejects.toThrow(errMsg);
      // Only the first (webSearch) attempt — no fallback call
      expect(chatCompletionSpy).toHaveBeenCalledTimes(1);
    },
  );
});
