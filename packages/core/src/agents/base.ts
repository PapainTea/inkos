import type { LLMClient, LLMMessage, LLMResponse, OnStreamProgress, OnStreamToken } from "../llm/provider.js";
import { chatCompletion } from "../llm/provider.js";
import { searchWeb, fetchUrl } from "../utils/web-search.js";
import type { Logger } from "../utils/logger.js";

export interface AgentContext {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly bookId?: string;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
  readonly onStreamToken?: OnStreamToken;
}

export abstract class BaseAgent {
  protected readonly ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  protected get log() {
    return this.ctx.logger;
  }

  protected async chat(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    return chatCompletion(this.ctx.client, this.ctx.model, messages, {
      ...options,
      onStreamProgress: this.ctx.onStreamProgress,
      onStreamToken: this.ctx.onStreamToken,
      logger: this.ctx.logger,
    });
  }

  /**
   * Chat with web search enabled.
   * OpenAI: uses native web_search_options / web_search_preview.
   * Other providers: searches via Tavily API (TAVILY_API_KEY), injects results into prompt.
   */
  protected async chatWithSearch(
    messages: ReadonlyArray<LLMMessage>,
    options?: { readonly temperature?: number; readonly maxTokens?: number },
  ): Promise<LLMResponse> {
    // OpenAI has native search — try it first, fall back to plain chat if the
    // provider doesn't support web_search_preview (common for 3rd-party
    // OpenAI-compatible proxies that don't implement the tool).
    if (this.ctx.client.provider === "openai") {
      try {
        return await chatCompletion(this.ctx.client, this.ctx.model, messages, {
          ...options,
          webSearch: true,
          onStreamProgress: this.ctx.onStreamProgress,
          onStreamToken: this.ctx.onStreamToken,
          logger: this.ctx.logger,
        });
      } catch (e) {
        const msg = String(e).toLowerCase();
        // Only fall back on EXPLICIT tool-unsupported errors. Broad patterns
        // like "400 && search" would silently eat legitimate errors such as
        // rate limits or invalid search queries, hiding real provider issues.
        const isToolUnsupported =
          msg.includes("unsupported tool") ||
          msg.includes("web_search_preview") ||
          msg.includes("tool type");
        if (isToolUnsupported) {
          this.log?.warn(
            "[search] Provider doesn't support web_search_preview, falling back to plain chat",
          );
          return this.chat(messages, options);
        }
        throw e;
      }
    }

    // Other providers: self-hosted search → inject results into prompt
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return this.chat(messages, options);
    }

    try {
      // Extract search query from user message (first 200 chars)
      const query = lastUserMsg.content.slice(0, 200);
      this.log?.info(`[search] Searching: ${query.slice(0, 60)}...`);

      const results = await searchWeb(query, 3);
      if (results.length === 0) {
        this.log?.warn("[search] No results found, falling back to regular chat");
        return this.chat(messages, options);
      }

      // Fetch top result for full content
      let fullContent = "";
      try {
        fullContent = await fetchUrl(results[0]!.url, 4000);
      } catch {
        // Fetch failed, use snippets only
      }

      const searchContext = [
        "## Web Search Results\n",
        ...results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`),
        ...(fullContent ? [`\n## Full Content (Top Result)\n${fullContent}`] : []),
      ].join("\n");

      // Inject search results before the last user message
      const augmentedMessages: LLMMessage[] = messages.map((m) =>
        m === lastUserMsg
          ? { ...m, content: `${searchContext}\n\n---\n\n${m.content}` }
          : m,
      );

      return this.chat(augmentedMessages, options);
    } catch (e) {
      this.log?.warn(`[search] Search failed: ${e}, falling back to regular chat`);
      return this.chat(messages, options);
    }
  }

  abstract get name(): string;
}
