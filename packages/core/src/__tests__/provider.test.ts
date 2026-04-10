import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { chatCompletion, isLikelyStreamError, type LLMClient } from "../llm/provider.js";

const ZERO_USAGE = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
} as const;

function makeStreamClient(create: ReturnType<typeof vi.fn>): LLMClient {
  return {
    provider: "openai",
    apiFormat: "chat",
    stream: true,
    _openai: {
      chat: {
        completions: {
          create,
        },
      },
    } as unknown as OpenAI,
    defaults: {
      temperature: 0.7,
      maxTokens: 512,
      thinkingBudget: 0,
      maxTokensCap: null,
      extra: {},
    },
  };
}

describe("chatCompletion stream fallback", () => {
  it("falls back to sync chat completion when streamed chat returns no chunks", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
          return;
        },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "fallback content" } }],
        usage: ZERO_USAGE,
      });

    const client = makeStreamClient(create);

    const result = await chatCompletion(client, "test-model", [
      { role: "user", content: "ping" },
    ]);

    expect(result.content).toBe("fallback content");
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ stream: true });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ stream: false });
  });
});

describe("isLikelyStreamError classification (Bug A)", () => {
  it("flags explicit stream / SSE / chunked signals as stream errors", () => {
    const streamLikeMessages = [
      "stream timed out while reading chunk",
      "text/event-stream parse failed",
      "sse connection dropped mid-response",
      "chunked encoding malformed",
      "unexpected end of input from upstream",
      "premature close of response body",
      "socket terminated before response completed",
      "ECONNRESET while streaming",
      "Error: response body transfer-encoding mismatch",
      "LLM returned empty response from stream",
    ];
    for (const msg of streamLikeMessages) {
      expect(isLikelyStreamError(new Error(msg))).toBe(true);
    }
  });

  it("does NOT flag generic 400 errors as stream errors (regression for 54s false freeze)", () => {
    const nonStream400s = [
      "400 Unsupported tool type: web_search_preview",
      "400 Invalid API key",
      "400 Model not found",
      "400 Max tokens exceeded",
      "400 Invalid message format",
    ];
    for (const msg of nonStream400s) {
      expect(isLikelyStreamError(new Error(msg))).toBe(false);
    }
  });

  it("still flags 400s that explicitly mention streaming keywords", () => {
    const stream400s = [
      "400 stream timeout while waiting for upstream",
      "400 SSE connection refused by provider",
      "400 chunked transfer failed midstream",
      "400 event-stream parser error",
    ];
    for (const msg of stream400s) {
      expect(isLikelyStreamError(new Error(msg))).toBe(true);
    }
  });

  it("does not flag unrelated errors (500, auth, network) as stream errors", () => {
    const unrelated = [
      "500 Internal server error",
      "401 Invalid API key",
      "429 Rate limit exceeded",
      "ENOTFOUND api.example.com",
    ];
    for (const msg of unrelated) {
      expect(isLikelyStreamError(new Error(msg))).toBe(false);
    }
  });
});

describe("chatCompletion sync fallback clears webSearch (Bug C)", () => {
  it("drops webSearch=true when retrying sync after stream failure", async () => {
    const create = vi.fn()
      .mockImplementationOnce(async () => {
        throw new Error("stream parse failed: text/event-stream corrupted");
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "sync ok" } }],
        usage: ZERO_USAGE,
      });

    const client = makeStreamClient(create);

    const result = await chatCompletion(
      client,
      "test-model",
      [{ role: "user", content: "ping" }],
      { webSearch: true },
    );

    expect(result.content).toBe("sync ok");
    expect(create).toHaveBeenCalledTimes(2);
    // First call is the stream attempt — it may carry web_search_options.
    // Second call is the sync fallback — it must NOT carry web_search_options.
    const syncCallArgs = create.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(syncCallArgs).toMatchObject({ stream: false });
    expect(syncCallArgs).not.toHaveProperty("web_search_options");
  });
});

describe("chatCompletion sync fallback SDK parse error (Bug D)", () => {
  it("throws a friendly Chinese error when provider returns SSE in sync mode", async () => {
    const create = vi.fn()
      .mockImplementationOnce(async () => {
        throw new Error("stream parser hit unexpected chunked payload");
      })
      .mockImplementationOnce(async () => {
        throw new TypeError(
          "Cannot use 'in' operator to search for 'object' in event: response.created\ndata: {}",
        );
      });

    const client = makeStreamClient(create);

    await expect(
      chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]),
    ).rejects.toThrow(/provider 返回畸形响应|SSE/);
  });

  it("passes through normal sync fallback errors without the malformed-response wrapper", async () => {
    const create = vi.fn()
      .mockImplementationOnce(async () => {
        throw new Error("stream parser failure: text/event-stream");
      })
      .mockImplementationOnce(async () => {
        throw new Error("network timeout while contacting upstream");
      });

    const client = makeStreamClient(create);

    await expect(
      chatCompletion(client, "test-model", [{ role: "user", content: "ping" }]),
    ).rejects.toThrow(/network timeout|Connection|API|upstream/);
  });
});
