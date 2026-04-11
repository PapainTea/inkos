# Bug Report: LLM 流错误回退链路导致"假卡住"

## 一、观察到的症状

### 用户反馈
1. **末日里-我只想给妹妹找个墓地** 第 4 章：卡在"状态结算"，实际失败
2. **镜源逆刻** 第 11 章：同样"卡住"现象（Windows 上写的，无日志）

### 日志证据（末日书第 4 章，`chapter-0004-write-20260410T041003.jsonl`）

```
L69  04:13:06 阶段 2：状态结算（第4章，9685字）    ← 状态结算开始
L70  04:13:06 阶段 2a：提取第4章事实
L99  04:14:28 阶段 2b：把观察结果回写到真相文件   ← 状态结算完成
L146 04:16:44 后写校验：第4章 1 个错误
             [error] 禁止句式: 出现了「不是……而是……」
L148 04:16:44 审计前触发 spot-fix 修补
L169 04:17:37 阶段：审计草稿
L173 04:18:24 阶段：自动修复关键问题
L621 04:19:54 阶段：修订后重新审计                ← reaudit 开始
L622 04:19:54 LLM call starting
             ctx: { provider: openai, model: gpt-5.2, stream: true }
L623 04:19:55 LLM stream error, retrying sync
             error: Error: 400 Unsupported tool type: web_search_preview
L624 04:20:49 LLM sync fallback also failed
             error: TypeError: Cannot use 'in' operator to search for 'object'
                    in event: response.created\ndata: {...}
L625 04:20:49 pipeline failed
```

**关键观察**：
- 状态结算 L69-99 实际完成（耗时 82 秒）
- 真正失败在 L621-625 的 **post-revision reaudit**
- 从 400 错误到最终失败中间**静默等待 54 秒**（L623 → L624）
- 用户前端看不到任何进展 → 感觉"卡住"

---

## 二、Bug 链路分析

### 触发条件
1. Provider：OpenAI 协议兼容的代理（`ai.qaq.al` / `gpt-5.2`）
2. 用户侧环境：`INKOS_PROVIDER=openai`，`stream: true`（默认）
3. 任何返回 `HTTP 400` 的请求

### 三层 bug 嵌套

#### Bug #1：`isLikelyStreamError` 把所有 400 当流错误
**位置**：`packages/core/src/llm/provider.ts:328-344`

```typescript
function isLikelyStreamError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("stream") ||
    msg.includes("text/event-stream") ||
    msg.includes("chunked") ||
    msg.includes("unexpected end") ||
    msg.includes("premature close") ||
    msg.includes("terminated") ||
    msg.includes("econnreset") ||
    (msg.includes("400") && !msg.includes("content"))  // ← 问题行
  );
}
```

**问题**：最后一条规则把**任意 400 错误**都判为"流相关"，只要错误消息里没有"content"这个词。

**实际后果**：
- `400 Unsupported tool type: web_search_preview` → 被当流错误 → 重试 sync
- `400 Invalid API key` → 被当流错误 → 重试 sync
- `400 Model not found` → 被当流错误 → 重试 sync

本应立即失败并报清晰错误的请求，全部被丢进 sync 重试。

---

#### Bug #2：`chatWithSearch` 对不支持 `web_search_preview` 的 provider 无降级
**位置**：`packages/core/src/agents/base.ts:44-57`

```typescript
protected async chatWithSearch(
  messages: ReadonlyArray<LLMMessage>,
  options?: { readonly temperature?: number; readonly maxTokens?: number },
): Promise<LLMResponse> {
  // OpenAI has native search — use it directly
  if (this.ctx.client.provider === "openai") {
    return chatCompletion(this.ctx.client, this.ctx.model, messages, {
      ...options,
      webSearch: true,  // ← 强制启用 web_search_preview
      onStreamProgress: this.ctx.onStreamProgress,
      onStreamToken: this.ctx.onStreamToken,
      logger: this.ctx.logger,
    });
  }
  // ... 非 openai provider 的 Tavily 路径有 try/catch
}
```

**问题**：`provider === "openai"` 包括所有 OpenAI 协议兼容代理（如 `ai.qaq.al`、`siliconflow`、`deepseek`、各种第三方代理）。这些代理大多**不支持** `web_search_preview` tool。代码直接调用，没有 try/catch，失败时不降级到普通 `chat`。

**触发路径**：
- `auditor.auditChapter` 在 `continuity.ts:542` 检查 `gp.eraResearch`
- 如果 true（`urban`、`sci-fi` genre），用 `chatWithSearch`
- `chatWithSearch` 对 openai provider 硬调用 `webSearch: true`
- 代理返回 400 → 失败

**影响的 genre**：`urban`（都市）、`sci-fi`（科幻）

**不影响的 genre**（镜源逆刻是 xuanhuan）：`xuanhuan`、`xianxia`、`horror` 等 eraResearch=false 的类型

---

#### Bug #3：sync 重试带着 `webSearch: true` 再次失败
**位置**：`packages/core/src/llm/provider.ts:303-306`

```typescript
if (client.apiFormat === "responses") {
  fallbackResult = await chatCompletionOpenAIResponsesSync(
    client._openai!, model, messages, resolved, options?.webSearch  // ← 仍然带 webSearch
  );
} else {
  fallbackResult = await chatCompletionOpenAIChatSync(
    client._openai!, model, messages, resolved, options?.webSearch  // ← 仍然带 webSearch
  );
}
```

**问题**：第一次请求因为 `webSearch: true` 被拒绝，sync 重试时**依然传 webSearch**，原封不动再请求一次，必然再次失败。

---

#### Bug #4：sync fallback 遇到 provider 畸形响应时静默挂起 + 错误污染
**位置**：`packages/core/src/llm/provider.ts:310-313`

```typescript
} catch (syncError) {
  logger?.error("LLM sync fallback also failed", {
    elapsedMs: Date.now() - startMs,
    error: String(syncError)
  });
  throw wrapLLMError(syncError, errorCtx);
}
```

**问题**：
- `ai.qaq.al` 这类代理即使 `stream: false` **仍然返回 SSE 格式** (`event: response.created\ndata: {...}`)
- OpenAI SDK 的同步解析器不处理 SSE，尝试 `'object' in response` 时 response 是字符串 → `TypeError: Cannot use 'in' operator`
- 错误耗时（L623→L624 间隔 54 秒）因为 SDK 可能在重试/累积数据
- 用户前端看到**静默 54 秒**然后报一个看似无关的 TypeError

**用户体验**：
```
04:19:54 LLM call starting   ← 前端看到 reaudit 开始
04:19:55 stream error        ← 前端不知道
... 54 秒静默 ...            ← 前端"卡住"
04:20:49 sync fallback failed
04:20:49 pipeline failed     ← 前端终于报错
```

---

## 三、为什么镜源逆刻第 11 章也卡住？

镜源逆刻是 `xuanhuan`（`eraResearch: false`），**不会走 `chatWithSearch`**。但它依然卡住，说明：

1. 第 11 章某次 LLM 调用返回了 400（原因未知，可能是 tokens 超限、messages 格式问题、或其他 provider 限制）
2. 被 Bug #1 判为流错误 → sync 重试
3. Provider 的 SSE 畸形响应触发 Bug #4 → 54 秒卡死 → 报错

**结论**：只要你用 `ai.qaq.al` 这类不规范的代理，**任何一次 400 都会让 pipeline 卡 54 秒后失败**，和具体哪个 agent（writer/auditor/reviser）无关。

---

## 四、预期修复

### Fix #1：收紧 `isLikelyStreamError` 的 400 判断
**位置**：`provider.ts:342`

```typescript
// 现状
(msg.includes("400") && !msg.includes("content"))

// 修复
(msg.includes("400") && (
  msg.includes("stream") ||
  msg.includes("sse") ||
  msg.includes("event-stream") ||
  msg.includes("chunked") ||
  msg.includes("transfer-encoding")
))
```

**效果**：只有**明确是流协议相关的 400** 才触发 sync 重试。其他 400（模型名错、tool 不支持、key 无效）立即失败并返回真正的错误消息。

**风险**：极低。原规则过于宽泛，收紧后不会影响合法的流错误路径。

---

### Fix #2：`chatWithSearch` 对 openai provider 加 try/catch 降级
**位置**：`base.ts:48-57`

```typescript
// 现状
if (this.ctx.client.provider === "openai") {
  return chatCompletion(this.ctx.client, this.ctx.model, messages, {
    ...options,
    webSearch: true,
    ...
  });
}

// 修复
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
    const isToolUnsupported =
      msg.includes("unsupported tool") ||
      msg.includes("web_search") ||
      msg.includes("tool type") ||
      (msg.includes("400") && msg.includes("search"));
    if (isToolUnsupported) {
      this.log?.warn(
        "[search] Provider doesn't support web_search_preview, falling back to plain chat"
      );
      return this.chat(messages, options);
    }
    throw e;
  }
}
```

**效果**：
- OpenAI 官方 provider 行为不变（不会 throw，直接走 try 路径成功）
- 兼容代理（ai.qaq.al 等）遇 400 → 自动降级到普通 chat → audit 继续跑

**风险**：低。只在 catch 时降级，正常路径零影响。

---

### Fix #3：sync 重试时清除 `webSearch`
**位置**：`provider.ts:303-306`

```typescript
// 现状
if (client.apiFormat === "responses") {
  fallbackResult = await chatCompletionOpenAIResponsesSync(
    client._openai!, model, messages, resolved, options?.webSearch
  );
} else {
  fallbackResult = await chatCompletionOpenAIChatSync(
    client._openai!, model, messages, resolved, options?.webSearch
  );
}

// 修复：sync 重试时禁用 webSearch
// 理由：如果 webSearch 在 stream 模式下失败了，sync 模式也很可能失败，
// 不如直接降级到普通 chat，保住请求能完成
if (client.apiFormat === "responses") {
  fallbackResult = await chatCompletionOpenAIResponsesSync(
    client._openai!, model, messages, resolved, false  // 禁用 webSearch
  );
} else {
  fallbackResult = await chatCompletionOpenAIChatSync(
    client._openai!, model, messages, resolved, false  // 禁用 webSearch
  );
}
```

**效果**：sync 重试时不再传 webSearch，避开同一个 tool 错误。

**风险**：如果 Fix #1 正确收紧了 400 判断，这条路径不会被触发到 webSearch 场景。但作为双重保险保留。

---

### Fix #4：sync fallback 识别 SDK 解析崩溃并给出明确错误
**位置**：`provider.ts:310-313`

```typescript
// 现状
} catch (syncError) {
  logger?.error("LLM sync fallback also failed", {
    elapsedMs: Date.now() - startMs,
    error: String(syncError)
  });
  throw wrapLLMError(syncError, errorCtx);
}

// 修复
} catch (syncError) {
  const msg = String(syncError);
  const isSdkParseError =
    msg.includes("Cannot use 'in' operator") ||
    msg.includes("response.created") ||
    (msg.includes("TypeError") && msg.includes("event:"));
  if (isSdkParseError) {
    logger?.error("LLM sync fallback failed: provider returned malformed response", {
      elapsedMs: Date.now() - startMs,
      error: msg.slice(0, 200),
      hint: "Provider likely returned SSE format even with stream=false. Consider switching provider or setting stream=true in client config.",
    });
    throw new Error(
      `LLM provider 返回畸形响应：stream=false 模式下仍返回 SSE 格式。\n` +
      `baseUrl: ${client.baseUrl ?? "(unknown)"}\n` +
      `model: ${model}\n` +
      `建议：换一个规范的 provider，或在 inkos.json 里尝试强制 stream=true`
    );
  }
  logger?.error("LLM sync fallback also failed", {
    elapsedMs: Date.now() - startMs,
    error: String(syncError)
  });
  throw wrapLLMError(syncError, errorCtx);
}
```

**效果**：
- 遇到 SDK 解析崩溃时给出**明确的 provider 问题提示**
- 用户能立刻知道是 provider 兼容性问题，不是我们代码 bug

**风险**：零。只是错误信息增强，不改变行为。

---

## 五、修复后的预期行为

### 场景 A：末日书第 4 章 reaudit
**修复前**：
- 400 Unsupported tool type → 误判为流错误 → sync 重试 → 带着 webSearch 再次失败 → SDK 解析崩溃 → 静默 54 秒 → 报一个看似无关的 TypeError → 用户以为卡在状态结算

**修复后（Fix #1 + #2 生效）**：
- `chatWithSearch` 调用 → 400 Unsupported → catch 降级到 plain chat → **audit 成功**
- 全程无感知，reaudit 正常完成

### 场景 B：镜源逆刻第 11 章（某个 400 错误）
**修复前**：
- 400 xxx → 误判流错误 → sync 重试 → SDK 解析崩溃 → 54 秒卡住 → 报错

**修复后（Fix #1 生效）**：
- 400 xxx → **不再误判为流错误** → 立即抛出真正的错误（带上 400 的具体原因）
- 用户立刻看到："第 11 章 LLM 调用失败：400 xxx，请检查 provider 配置"
- 不再有 54 秒假卡住

### 场景 C：用户换规范 provider（OpenAI 官方）
**修复前/后行为一致**：全程无感知，正常工作。

---

## 六、测试计划

### 单元测试（如果可以）
1. `isLikelyStreamError`：
   - 输入 "400 Unsupported tool type" → 返回 false
   - 输入 "stream error" → 返回 true
   - 输入 "400 bad request" → 返回 false
   - 输入 "400 stream timeout" → 返回 true

2. `chatWithSearch`：
   - mock openai client 第一次抛 "400 Unsupported tool type"
   - 期望调用 fallback 的 `this.chat(messages, options)`
   - 验证 log.warn 被调用

### 手工验收
1. 用 `ai.qaq.al` + `gpt-5.2` 给末日书写一章（带 eraResearch=true）
   - 期望：audit 降级为 plain chat，全程完成，无 54 秒卡住
2. 用 `ai.qaq.al` + `gpt-5.2` 给镜源逆刻写一章
   - 期望：如果遇到 400，立即失败并报告真实错误（<5 秒）
3. Windows 版本回归：确保改动对 Windows 无影响（纯逻辑修改，跨平台一致）

### 回归测试
- 运行 `packages/core` 的现有测试套件确保没有回归
- 特别检查 `base-agent.test.ts` 里的 `chatWithSearch` 测试

---

## 七、影响范围

**文件改动**：
- `packages/core/src/llm/provider.ts`（Fix #1, #3, #4）
- `packages/core/src/agents/base.ts`（Fix #2）

**无跨平台差异**：所有修复都是纯 TypeScript 逻辑修改，Mac / Windows 行为一致。

**无数据迁移**：不影响任何用户数据（books、ledger、hooks 等）。

**版本**：建议作为 patch 版本发布（v0.2.2.6），提交信息标记 `‼️` 作为安全回退点。

---

## 八、决策请求

请确认以下几点再开始修复：

1. ✅ Fix #1（收紧 400 判断）— **建议必做**，这是最核心的 bug
2. ✅ Fix #2（chatWithSearch 降级）— **建议必做**，直接解决末日书的问题
3. ✅ Fix #3（sync 重试清 webSearch）— **建议做**，双重保险
4. ✅ Fix #4（错误信息增强）— **建议做**，改善用户体验
5. ⚠️ 是否需要发新版本 v0.2.2.6 并重新打包？
6. ⚠️ 是否需要同步更新 `last_seen_version.json` / `CHANGELOG`？

等你确认后开始修。
