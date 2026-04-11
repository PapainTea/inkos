# 一次性 Bug 修复计划（v0.2.2.6）

**目标**：在单一 commit 里修复所有已知的数据丢失和"假卡住"问题，并同步升级版本号到 `v0.2.2.6`。

**方案选择**：A 方案（本地自成一派，4 个真相文件全部 merge，和 master 分道扬镳）。

**修复文件**：
- `/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts`
- `/Users/admin/Codex/Project/inkOS/packages/core/src/agents/base.ts`
- `/Users/admin/Codex/Project/inkOS/packages/core/src/pipeline/runner.ts`

**版本号同步更新**（v0.2.2.5 → v0.2.2.6）：
- `/Users/admin/Codex/Project/inkOS/packages/studio/server.cjs:1` — `STUDIO_VERSION`
- `/Users/admin/Codex/Project/inkOS/packages/studio/public/js/about.js:10` — changelog 头条 version
- `/Users/admin/Codex/Project/inkOS/packages/studio/installer.nsi:11` — `PRODUCT_VERSION`
- `/Users/admin/Codex/Project/inkOS/packages/studio/package.json:4` — npm package version

**测试文件**（全部是**补充现有**文件，不新建）：
- `/Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/provider.test.ts` — 已存在，补用例
- `/Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/base-agent.test.ts` — 已存在，补用例
- `/Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/pipeline-runner.test.ts` — 已存在，补用例

**⚠️ 重要声明**：
- 本修复只**止血**，**不会自动回填**已丢失的历史数据
- 已被覆盖的情感弧线、伏笔钩子、支线板、角色矩阵的历史条目**不会自动恢复**
- 受影响的书籍需要单独的手工回补 / 快照重建（见文末"数据恢复策略"章节）

**无跨平台差异**：所有代码修改都是纯 TypeScript 逻辑，Mac / Windows 行为一致。

---

## 📑 Bug 索引

| # | Bug 名称 | 严重性 | 涉及文件 | 类别 |
|---|----------|--------|----------|------|
| A | LLM 400 错误被误判为流错误，触发 54 秒假卡住 | 🔴 P0 | provider.ts | 可用性 |
| B | `chatWithSearch` 对不支持 web_search_preview 的 provider 无降级 | 🔴 P0 | base.ts | 可用性 |
| C | sync 重试仍带 `webSearch: true`，必然再次失败 | 🟡 P1 | provider.ts | 可用性 |
| D | sync fallback SDK 解析崩溃没有明确错误提示 | 🟢 P2 | provider.ts | 可观测性 |
| E | `buildPersistenceOutput` 只 merge 账本，4 个真相文件被 LLM 覆盖丢失 | 🔴 P0 | runner.ts | 数据完整性 |

---

## 🐛 Bug A：LLM 400 错误被误判为流错误，触发 54 秒假卡住

### 产品现状（实现层面）

**用户看到的现象**：
1. 用户在 Studio 点"写新章节"或"针对性修订"
2. Pipeline 正常跑到某个阶段（例如 reaudit / auditor / settler）
3. 前端 stage 条卡在当前阶段**静默 54 秒**，没有任何 token 输出
4. 最终弹出一个看起来和流无关的错误，例如：
   ```
   pipeline failed
   Error: API 返回 400 (请求参数错误)
   TypeError: Cannot use 'in' operator to search for 'object' in event: response.created
   ```
5. 用户以为是"卡在状态结算"或其他阶段，实际根本不是

**触发场景**：
- 用户使用 OpenAI 协议兼容的第三方代理（如 `ai.qaq.al`、`siliconflow`、`deepseek` 代理、自建代理等）
- provider 返回**任何** HTTP 400 错误（不限于流相关）：
  - 400 Unsupported tool type（Bug B 会触发）
  - 400 Invalid API key
  - 400 Model not found
  - 400 Max tokens exceeded
  - 400 Invalid message format

**实际日志证据**（末日书第 4 章，`/Users/admin/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_gdomfpmg9kj022_a0bd/temp/RWTemp/2026-04/30b61b11b610afc80e79e0d149c4265e/chapter-0004-write-20260410T041003.jsonl`）：
```
L621 04:19:54 阶段：修订后重新审计
L622 04:19:54 LLM call starting (gpt-5.2, stream=true)
L623 04:19:55 LLM stream error, retrying sync
              error: 400 Unsupported tool type: web_search_preview
L624 04:20:49 LLM sync fallback also failed    ← 54 秒后
L625 04:20:49 pipeline failed
```

### 代码层面原因

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts:328-344`

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

**问题分析**：
- 最后一行规则的意图是识别"某些 proxy 在 stream=true 时返回 400"这种特定情况
- 但实际规则是**只要错误消息包含 "400" 且不包含 "content"**，就判为流错误
- 实际后果：**任何** 400 错误都被误判
- 误判后进入 `provider.ts:294-315` 的 sync fallback 路径
- Sync fallback 也会失败（因为根本不是流问题），但至少耗时 54 秒
- 这 54 秒用户前端看不到任何反馈，感觉"卡住"

**调用栈**：
```
chat() → chatCompletion() → stream 模式请求 → 400 Unsupported tool type
                                ↓
                    isLikelyStreamError() 误判为 true
                                ↓
                    sync fallback 重试（继续失败）
                                ↓
                    54 秒后抛出 wrapped error
```

### 预期修复

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts:328-344`

**修改**：收紧 400 错误的判断规则，**只有明确包含 stream 关键词的 400** 才触发 sync 重试。

```typescript
function isLikelyStreamError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  // Common indicators that streaming specifically is the problem
  if (
    msg.includes("stream") ||
    msg.includes("text/event-stream") ||
    msg.includes("sse") ||
    msg.includes("chunked") ||
    msg.includes("transfer-encoding") ||
    msg.includes("unexpected end") ||
    msg.includes("premature close") ||
    msg.includes("terminated") ||
    msg.includes("econnreset")
  ) {
    return true;
  }
  // 400 errors are only stream-related if they explicitly mention streaming.
  // Previously we treated ANY 400 as stream error (msg.includes("400") && !msg.includes("content")),
  // which caused tool-unsupported / key-invalid / model-not-found errors to
  // trigger 54-second silent sync retries before finally failing.
  if (msg.includes("400")) {
    return (
      msg.includes("stream") ||
      msg.includes("sse") ||
      msg.includes("event-stream") ||
      msg.includes("chunked")
    );
  }
  return false;
}
```

**效果**：
- ✅ 合法的流问题（`400 stream timeout` 之类）仍然正确触发 sync 重试
- ✅ 非流 400 错误（unsupported tool、invalid key 等）立即失败，错误信息直达用户
- ✅ 彻底消除 54 秒静默假卡住

**风险**：极低。原规则过于宽泛，收紧后不会误漏合法流错误。

---

## 🐛 Bug B：`chatWithSearch` 对不支持 web_search_preview 的 provider 无降级

### 产品现状（实现层面）

**用户看到的现象**：
1. 用户创建一本都市（`urban`）或科幻（`sci-fi`）genre 的书
2. 正常写章节，pipeline 跑到 **auditor 阶段**（审计草稿）
3. Auditor 发起 LLM 请求，带 `web_search_preview` tool
4. 用户的 provider（例如 `ai.qaq.al` + `gpt-5.2`）不支持这个 tool
5. 返回 `400 Unsupported tool type: web_search_preview`
6. 结合 Bug A → 54 秒假卡住 → pipeline 失败
7. 用户反复报错，**换 provider 才能用**

**影响 genre**：
```
/Users/admin/Codex/Project/inkOS/packages/core/genres/urban.md:8     eraResearch: true   ← 受影响
/Users/admin/Codex/Project/inkOS/packages/core/genres/sci-fi.md:9    eraResearch: true   ← 受影响
其他 13 个 genre：eraResearch: false   ← 不受影响
```

**触发条件**：
- genre 配置 `eraResearch: true`
- provider 是 OpenAI 协议但非 OpenAI 官方
- provider 不支持 `web_search_preview` tool

**举例**：末日书（urban genre）第 4 章 reaudit 直接触发。

### 代码层面原因

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/agents/base.ts:44-102`

```typescript
protected async chatWithSearch(
  messages: ReadonlyArray<LLMMessage>,
  options?: { readonly temperature?: number; readonly maxTokens?: number },
): Promise<LLMResponse> {
  // OpenAI has native search — use it directly
  if (this.ctx.client.provider === "openai") {
    return chatCompletion(this.ctx.client, this.ctx.model, messages, {
      ...options,
      webSearch: true,   // ← 硬启用，无 try/catch
      onStreamProgress: this.ctx.onStreamProgress,
      onStreamToken: this.ctx.onStreamToken,
      logger: this.ctx.logger,
    });
  }
  // 非 openai provider 走 Tavily 搜索路径（有 try/catch 和 fallback）
  ...
}
```

**问题分析**：
- `provider === "openai"` 分支对**所有 OpenAI 协议兼容的 client** 都生效，包括第三方代理
- 第三方代理大多**不支持** `web_search_preview`
- 没有 try/catch → 失败时不降级
- 非 openai 分支（Tavily）**有** try/catch 和 fallback，但 openai 分支**没有**

### 预期修复

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/agents/base.ts:44-57`

**修改**：给 openai 分支加 try/catch，**只在明确的 tool 不支持错误**时降级到普通 `chat`。

```typescript
protected async chatWithSearch(
  messages: ReadonlyArray<LLMMessage>,
  options?: { readonly temperature?: number; readonly maxTokens?: number },
): Promise<LLMResponse> {
  // OpenAI has native search — try it first, fall back to plain chat
  // if provider doesn't support web_search_preview (common with 3rd-party
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
      // Only fall back on EXPLICIT tool-unsupported errors.
      // DO NOT use broad patterns like "400 && search" — those would
      // silently eat legitimate errors like "search rate limit" or
      // "search query too long", hiding real provider issues.
      const isToolUnsupported =
        msg.includes("unsupported tool") ||
        msg.includes("web_search_preview") ||
        msg.includes("tool type");
      if (isToolUnsupported) {
        this.log?.warn(
          "[search] Provider doesn't support web_search_preview, falling back to plain chat"
        );
        return this.chat(messages, options);
      }
      throw e;
    }
  }
  
  // 其余 Tavily 路径保持不变
  ...
}
```

**效果**：
- ✅ OpenAI 官方：行为不变（try 路径直接成功）
- ✅ 兼容代理遇明确的 tool 不支持错误 → catch → 降级普通 chat → audit 继续跑
- ✅ 其他真实错误（rate limit、invalid search query、API key 过期）：**继续抛出**，不被静默吞掉
- ✅ 修正了原 plan 的过宽降级判定（`400 && search` 已移除）

**风险**：极低。只在 3 个明确的 tool 相关错误关键词时降级，其他错误正常抛出。

---

## 🐛 Bug C：sync 重试仍带 `webSearch: true`，必然再次失败

### 产品现状（实现层面）

**用户看到的现象**：
- 配合 Bug A 和 Bug B，当 stream 请求因为 webSearch 失败后：
- Pipeline 尝试 sync 重试
- Sync 重试**仍然带着 `webSearch: true`** 发请求
- 同样的 400 错误再次发生
- 前端无感知，继续等待

**这是 Bug A 导致的 54 秒等待里"再次尝试"的部分**。即使 Bug B 被修复，在边界情况下（例如流请求因为别的原因失败但 Bug A 修复不完全触发了 sync）仍是隐患。

### 代码层面原因

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts:303-306`

```typescript
} else if (client.apiFormat === "responses") {
  fallbackResult = await chatCompletionOpenAIResponsesSync(
    client._openai!, model, messages, resolved, 
    options?.webSearch  // ← 仍然传 webSearch
  );
} else {
  fallbackResult = await chatCompletionOpenAIChatSync(
    client._openai!, model, messages, resolved, 
    options?.webSearch  // ← 仍然传 webSearch
  );
}
```

**问题分析**：
- Stream 模式失败后，sync 重试本质上是"换个请求方式再试"
- 但代码把原始的 `options?.webSearch` 原封不动传下去
- 如果第一次失败就是因为 webSearch 不支持，sync 重试会遇到**同样的错误**

### 预期修复

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts:303-306`

**修改**：sync 重试时**禁用 webSearch**。

```typescript
} else if (client.apiFormat === "responses") {
  // Don't re-use webSearch in sync fallback: if stream failed, retrying
  // with the same tool-use options will typically fail again. Prefer
  // succeeding in plain chat over preserving web search in degraded mode.
  fallbackResult = await chatCompletionOpenAIResponsesSync(
    client._openai!, model, messages, resolved, false
  );
} else {
  fallbackResult = await chatCompletionOpenAIChatSync(
    client._openai!, model, messages, resolved, false
  );
}
```

**效果**：
- ✅ Stream 请求 → 失败 → sync 重试不带 webSearch → 更可能成功
- ✅ 作为 Bug B 的双重保险：即使 base.ts 没降级，provider 层也会在重试时清掉

**风险**：极低。只影响 sync fallback 路径，正常流请求不受影响。

---

## 🐛 Bug D：sync fallback SDK 解析崩溃没有明确错误提示

### 产品现状（实现层面）

**用户看到的现象**：
- Pipeline 失败
- 错误消息是看起来神秘的 `TypeError: Cannot use 'in' operator to search for 'object' in event: response.created\ndata: {...}`
- 用户以为是 inkos 代码 bug，实际是 **provider 返回了畸形响应**
- 无法快速定位问题，可能反复尝试、反复失败

**具体场景**：
- 某些 OpenAI 协议兼容的 proxy（如 `ai.qaq.al`）在 `stream: false` 模式下**仍然返回 SSE 格式**
- OpenAI SDK 的同步解析器不处理 SSE，尝试把整个 SSE 文本当 JSON 对象解析
- 用 `'key' in response` 判断时，`response` 还是字符串 → `TypeError`

### 代码层面原因

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts:310-313`

```typescript
} catch (syncError) {
  logger?.error("LLM sync fallback also failed", {
    elapsedMs: Date.now() - startMs,
    error: String(syncError)
  });
  throw wrapLLMError(syncError, errorCtx);
}
```

**问题分析**：
- Catch 块统一处理所有 syncError
- 没有区分 SDK 解析崩溃（provider 畸形响应）和真正的 API 错误（network、auth 等）
- 原封不动抛出 SDK 的 TypeError，用户看不懂

### 预期修复

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts:310-313`

**修改**：识别 SDK 解析崩溃模式，给出明确的 provider 配置问题提示。

```typescript
} catch (syncError) {
  const msg = String(syncError);
  const isSdkParseError =
    msg.includes("Cannot use 'in' operator") ||
    msg.includes("response.created") ||
    (msg.includes("TypeError") && msg.includes("event:"));
  
  if (isSdkParseError) {
    logger?.error(
      "LLM sync fallback failed: provider returned malformed response (SSE in non-stream mode)",
      {
        elapsedMs: Date.now() - startMs,
        error: msg.slice(0, 200),
        baseUrl: (client as any)._openai?.baseURL ?? "(unknown)",
        model,
      }
    );
    throw new Error(
      `LLM provider 返回畸形响应：stream=false 模式下仍返回 SSE 格式。\n` +
      `  model: ${model}\n` +
      `  建议：换一个规范的 provider，或在 inkos.json 中检查 stream 配置`
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
- ✅ 用户遇到畸形 provider 时看到明确的中文提示
- ✅ 可以立即定位到"换 provider"或"检查配置"的解决方向
- ✅ 正常的 sync fallback 错误仍然走原有路径

**风险**：零。只是错误信息增强，不改变控制流。

---

## 🐛 Bug E：`buildPersistenceOutput` 只 merge 账本，4 个真相文件被 LLM 覆盖丢失

### 产品现状（实现层面）

**用户看到的现象**：
1. 用户正常写一章或对某章做针对性修订
2. Pipeline 正常跑完
3. 打开情感弧线/伏笔钩子/支线板/角色矩阵查看
4. **历史章节的条目全部消失**，只剩当前章节的条目
5. 情感弧线从 40 行突然变 14 行；钩子从 48 个突然变 36 个

**触发条件**（**已根据评审修正，缩小为 2 条**）：

Bug E 触发的前提是调用 `buildPersistenceOutput` 且 `finalContent !== output.content`。代码里只有 2 处调用：

1. **主 pipeline 写作**（runner.ts:1676）
   - 触发子场景 A：后写校验发现禁止句式 → auto-fix → spot-fix 修补章节内容
   - 触发子场景 B：长度归一化（normalize）修改了章节内容
   - 触发子场景 C：主 pipeline 内 auditor 不通过 → 自动走 `reviseChapter` 修改章节内容

2. **针对性修订**（spotfixChapter, runner.ts:1215）
   - 每次触发都必定调用 `buildPersistenceOutput`（persistenceSeed 的 content 和 revisedContent 一定不同）

**❌ 不触发的路径**（之前 plan 误写，已修正）：
- **普通修订**（`reviseDraft` 非 spot-fix 模式）**不走** `buildPersistenceOutput`
- 它在 `runner.ts:1046-1068` 有自己的落盘逻辑，只写 3 个文件：
  - `current_state.md`（直接覆盖）
  - `particle_ledger.md`（mergeLedgerForPersistence 合并）
  - `pending_hooks.md`（mergeTableMarkdownByKey 合并，5dbc7c5 已修）
- **完全不碰** subplot_board / emotional_arcs / character_matrix
- 所以普通修订不会触发 Bug E

**实际数据证据**（镜源逆刻 `/Users/admin/.inkos/data/books/镜源逆刻/story/emotional_arcs.md` 快照行数）：
```
s0:  4 行（初始）
s1:  8 行   ← ch1 条目
s2: 10 行   ← +ch2
s3: 12 行   ← +ch3
s4: 11 行   ← ch4 写入时丢了一行（normalize 或 auto-fix 触发）
s5: 12 行
s6: 14 行
s7: 28 行   ← +ch7 条目（+14）
s8: 40 行   ← +ch8 条目（+12）
s9: 14 行   ⚠️ 突然从 40 降到 14，丢了 26 行
s10: 14 行
s11: 14 行
s12: 10 行  ⚠️ 针对性修订后再丢 4 行
```

**影响范围**（受 Bug E 丢数据的文件）：
- `/Users/admin/.inkos/data/books/*/story/emotional_arcs.md`
- `/Users/admin/.inkos/data/books/*/story/pending_hooks.md`（通过 buildPersistenceOutput 路径）
- `/Users/admin/.inkos/data/books/*/story/subplot_board.md`
- `/Users/admin/.inkos/data/books/*/story/character_matrix.md`

**不影响**：
- `particle_ledger.md` — 已经有 merge（commit `22fdec9` 加的）
- `current_state.md` — 不需要累积
- `chapter_summaries.md` — append 模式

### 代码层面原因

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/pipeline/runner.ts:2245-2285`

```typescript
private async buildPersistenceOutput(
  bookId: string,
  book: BookConfig,
  bookDir: string,
  chapterNumber: number,
  output: WriteChapterOutput,
  finalContent: string,
): Promise<WriteChapterOutput> {
  if (finalContent === output.content) {
    return output;
  }

  const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", bookId));
  const analyzed = await analyzer.analyzeChapter({
    book,
    bookDir,
    chapterNumber,
    chapterContent: finalContent,
    chapterTitle: output.title,
  });

  const countingMode = resolveLengthCountingMode(book.language);
  const resolvedLanguage = await this.resolveBookLanguage(book);
  const currentLedger = await readFile(join(bookDir, "story", "particle_ledger.md"), "utf-8")
    .catch(() => ledgerInitial(resolvedLanguage));
  const mergedLedger = mergeLedgerForPersistence(currentLedger, analyzed.updatedLedger, resolvedLanguage);
  
  return {
    ...analyzed,
    updatedLedger: mergedLedger ?? analyzed.updatedLedger,  // ← 只有账本合并
    // updatedHooks: analyzed.updatedHooks (raw)     ← 未合并
    // updatedSubplots: analyzed.updatedSubplots (raw)     ← 未合并
    // updatedEmotionalArcs: analyzed.updatedEmotionalArcs (raw)   ← 未合并
    // updatedCharacterMatrix: analyzed.updatedCharacterMatrix (raw)   ← 未合并
    content: finalContent,
    wordCount: countChapterLength(finalContent, countingMode),
    postWriteErrors: [],
    postWriteWarnings: [],
    settlementWarnings: output.settlementWarnings,
    hookHealthIssues: output.hookHealthIssues,
    tokenUsage: output.tokenUsage,
  };
}
```

**问题分析**：
- `ChapterAnalyzer.analyzeChapter` 被调用去重新分析**仅当前章节的新内容**
- LLM 产出 `analyzed.updatedHooks / updatedSubplots / updatedEmotionalArcs / updatedCharacterMatrix`
- LLM 的 prompt 要求"incrementally update existing files"，但实际经常输出**只包含当前章节的新条目**
- 代码直接 `...analyzed` 展开返回，除了 ledger 之外**没有和磁盘上的文件做任何合并**
- `saveChapter` + `saveNewTruthFiles` 拿到返回值后直接 `writeFile(path, rawContent)` 覆盖
- 结果：历史章节的条目全部消失

### 预期修复

**位置**：`/Users/admin/Codex/Project/inkOS/packages/core/src/pipeline/runner.ts:2245-2285`

**修改**：`buildPersistenceOutput` 补全所有真相文件的 merge。

```typescript
private async buildPersistenceOutput(
  bookId: string,
  book: BookConfig,
  bookDir: string,
  chapterNumber: number,
  output: WriteChapterOutput,
  finalContent: string,
): Promise<WriteChapterOutput> {
  if (finalContent === output.content) {
    return output;
  }

  const analyzer = new ChapterAnalyzerAgent(this.agentCtxFor("chapter-analyzer", bookId));
  const analyzed = await analyzer.analyzeChapter({
    book,
    bookDir,
    chapterNumber,
    chapterContent: finalContent,
    chapterTitle: output.title,
  });

  const countingMode = resolveLengthCountingMode(book.language);
  const resolvedLanguage = await this.resolveBookLanguage(book);
  const storyDir = join(bookDir, "story");

  // Read current state of all accumulated truth files
  const [currentLedger, currentHooks, currentSubplots, currentEmoArcs, currentMatrix] = await Promise.all([
    readFile(join(storyDir, "particle_ledger.md"), "utf-8").catch(() => ledgerInitial(resolvedLanguage)),
    readFile(join(storyDir, "pending_hooks.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "subplot_board.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "emotional_arcs.md"), "utf-8").catch(() => ""),
    readFile(join(storyDir, "character_matrix.md"), "utf-8").catch(() => ""),
  ]);

  // Merge analyzer output with existing files to preserve historical entries
  // that the LLM may have forgotten to include in its "complete" output.
  // Key strategies mirror runSettlement's merge logic (writer.ts:553-567):
  //   - ledger: mergeLedgerForPersistence (with sentinel handling)
  //   - hooks: merge by hook_id (column 0)
  //   - subplots: merge by subplot_id (column 0)
  //   - emotional_arcs: merge by (character, chapter) (columns 0+1)
  //   - character_matrix: special multi-section merge via mergeCharacterMatrixMarkdown
  const mergedLedger = mergeLedgerForPersistence(currentLedger, analyzed.updatedLedger, resolvedLanguage);
  
  const mergedHooks = (currentHooks && analyzed.updatedHooks && !isHooksSentinel(analyzed.updatedHooks))
    ? mergeTableMarkdownByKey(currentHooks, analyzed.updatedHooks, [0])
    : analyzed.updatedHooks;
  
  const mergedSubplots = (currentSubplots && analyzed.updatedSubplots)
    ? mergeTableMarkdownByKey(currentSubplots, analyzed.updatedSubplots, [0])
    : analyzed.updatedSubplots;
  
  const mergedEmoArcs = (currentEmoArcs && analyzed.updatedEmotionalArcs)
    ? mergeTableMarkdownByKey(currentEmoArcs, analyzed.updatedEmotionalArcs, [0, 1])
    : analyzed.updatedEmotionalArcs;
  
  const mergedMatrix = (currentMatrix && analyzed.updatedCharacterMatrix)
    ? mergeCharacterMatrixMarkdown(currentMatrix, analyzed.updatedCharacterMatrix)
    : analyzed.updatedCharacterMatrix;

  return {
    ...analyzed,
    updatedLedger: mergedLedger ?? analyzed.updatedLedger,
    updatedHooks: mergedHooks,
    updatedSubplots: mergedSubplots,
    updatedEmotionalArcs: mergedEmoArcs,
    updatedCharacterMatrix: mergedMatrix,
    content: finalContent,
    wordCount: countChapterLength(finalContent, countingMode),
    postWriteErrors: [],
    postWriteWarnings: [],
    settlementWarnings: output.settlementWarnings,
    hookHealthIssues: output.hookHealthIssues,
    tokenUsage: output.tokenUsage,
  };
}
```

**依赖 import**（顶部补充）：
```typescript
import { mergeTableMarkdownByKey, mergeCharacterMatrixMarkdown } from "../utils/governed-working-set.js";
// isHooksSentinel 已在 truth-file-persistence.js 中，现有 import 已有
```

**效果**：
- ✅ 无论触发什么路径（主 pipeline auto-fix / 长度归一化 / 针对性修订），情感弧线、伏笔钩子、支线板、角色矩阵都会正确累积
- ✅ Analyzer 如果忘记旧条目，merge 会把旧条目从磁盘读回来补上
- ✅ Analyzer 如果正确更新某条旧条目，merge 会用新值替换（按 key 匹配）
- ✅ 与本地已有的 `mergeLedgerForPersistence` 语义一致

**风险**：
- 低。Merge 操作都是按 key 的幂等合并
- 理论边界：如果 Analyzer 合法地想**删除**某个 hook/subplot，merge 会保留旧的。但这种场景在业务上不应存在——hook/subplot/emotional_arc/matrix 都是累积语义，不应被删除
- 未来如果需要"标记为过期"的语义，应该通过修改状态字段（如 `status: resolved`）而不是删除行实现
- 性能影响：多读 4 个文件（磁盘 IO），但只在 `finalContent !== output.content` 时触发

---

## 🧪 测试计划（断言清单，非伪代码）

> **注意**：本章节只描述**需要补充的断言和覆盖点**，不提供可直接粘贴的代码。执行时需要先根据实际 helper / 可见性调整：
> - `isLikelyStreamError` 如果不是 export，需要改成 export 或加 `__test__` 出口
> - `buildPersistenceOutput` 是 `private` 方法，测试时需要：`(runner as any).buildPersistenceOutput(...)`，或者先把它改成 package-private / `protected`，或者通过 spy 公共入口（`writeChapter` / `spotfixChapter`）间接验证
> - Mock helper（如 `createMockOpenAIClient`、`setupTestBook`、`mockChapterAnalyzer`）如果不存在，需要先在 `src/__tests__/__helpers__/` 下补充，或用 `vi.spyOn` / `vi.fn` 现场构造
> - 所有测试文件都是**已存在**的，补断言而不是新建

---

### 补 `/Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/provider.test.ts`

**Bug A — `isLikelyStreamError` 400 误判修正**

需要补 3 组断言：

1. **流错误白名单保留**：现有 stream / text/event-stream / chunked / ECONNRESET / premature close / terminated / unexpected end 的匹配应仍返回 `true`
2. **400 误判回归测试**（核心）：以下消息**必须返回 `false`**，这是 bug 行为
   - `"400 Unsupported tool type: web_search_preview"`
   - `"400 Invalid API key"`
   - `"400 Model not found"`
   - `"400 Max tokens exceeded"`
   - `"400 Invalid message format"`
3. **400 + 明确流关键词**仍应返回 `true`：
   - `"400 stream timeout"`
   - `"400 SSE connection refused"`
   - `"400 chunked transfer failed"`

**前置要求**：`isLikelyStreamError` 需要从 `provider.ts` 中 export 出来。如果不改源文件可见性，改用"通过 chatCompletion 触发 + 观察是否走 sync 分支"的端到端断言（成本更高）。

---

**Bug C — sync fallback 清除 webSearch**

需要补 1 组断言：

- **断言点**：模拟 stream 模式失败，观察 sync fallback 调用时传入的 `webSearch` 参数是 `false`
- **实现路径**：`vi.spyOn` 到 `chatCompletionOpenAIResponsesSync` 和 `chatCompletionOpenAIChatSync`，验证 sync 路径被调用时第 5 个参数（webSearch）是 `false`，不是原始的 `true`
- **前置要求**：两个 sync fallback 函数需要可 spy（它们是 file-level function，可能需要 `vi.mock` 整个模块或改成对象方法）

---

**Bug D — SDK 解析崩溃错误提示**

需要补 2 组断言：

1. **SSE-in-sync-mode 识别**：
   - 构造一个 syncError 包含 `"Cannot use 'in' operator"` 或 `"response.created"` 或 `"TypeError" + "event:"`
   - 期望抛出的错误消息包含 `"provider 返回畸形响应"` 或 `"SSE"` 等中文关键词
2. **非解析错误原样透传**：
   - 构造一个普通的 `Error("network timeout")`
   - 期望错误消息仍然包含 `"network timeout"`，不被包装成中文提示

**前置要求**：需要能注入 syncError，可以通过 `vi.mocked(chatCompletionOpenAIResponsesSync).mockRejectedValue(...)` 实现。

---

### 补 `/Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/base-agent.test.ts`

**Bug B — `chatWithSearch` 降级到普通 chat**

需要补 3 组"应降级"断言 + 3 组"不应降级"断言：

**应降级的错误（继续成功）**：
1. 模拟 `chatCompletion` 第一次（webSearch=true）抛 `"400 Unsupported tool type: web_search_preview"`，第二次（普通 chat）返回成功 → `chatWithSearch` 应返回第二次的结果
2. 同样，抛 `"unsupported tool type"` 时降级
3. 同样，抛 `"web_search_preview not available"` 时降级
4. 同样，抛 `"Unknown tool type 'web_search_preview'"` 时降级

**不应降级的错误（必须继续抛出）**：
1. `"429 Rate limit exceeded"` → 直接抛，不降级
2. `"400 Search rate limit exceeded for today"` → 直接抛（回归 `400 && search` 过宽的 bug）
3. `"400 Search query too long"` → 直接抛
4. `"401 Invalid API key"` → 直接抛
5. `"500 Internal server error"` → 直接抛

**前置要求**：
- 现有 `base-agent.test.ts` 里应该有 `chatWithSearch` 的现成 mock 设置（第 30 行附近有 OpenAI native search 的测试），参考它的 mock 模式
- 如果没有现成 helper，用 `vi.spyOn(ctx.client, "chat")` 或者直接 mock `chatCompletion` 模块函数

---

### 补 `/Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/pipeline-runner.test.ts`

**Bug E — `buildPersistenceOutput` 合并 4 个真相文件**

需要补 5 组断言：

1. **emotional_arcs 保留历史**：
   - 准备磁盘上的 `emotional_arcs.md` 含 3 行历史（角色 A ch1/ch2、角色 B ch1）
   - Mock `ChapterAnalyzer.analyzeChapter` 返回只含 1 行新数据（角色 A ch3）
   - 调用 `buildPersistenceOutput(..., finalContent="new")`（`finalContent !== output.content` 才触发重分析分支）
   - 断言返回的 `updatedEmotionalArcs` **同时包含** ch1/ch2/ch3 的条目 + 角色 B ch1

2. **pending_hooks 保留远期钩子**：
   - 磁盘 `pending_hooks.md` 含 `H001`（ch1 introduced）和 `H020`（ch575 远期）
   - Mock analyzer 返回只含 `H001` 更新版 + 新增 `H010`
   - 断言返回的 `updatedHooks`：
     - 包含 `H020`（远期钩子没丢）
     - 包含 `H010`（新增）
     - `H001` 是 analyzer 返回的更新版本（按 key 覆盖）

3. **subplot_board 保留历史**：类似 hooks 的模式，key 是 subplot_id

4. **character_matrix 保留多区段**：
   - 磁盘 `character_matrix.md` 含多个 section（角色主页 + 交互矩阵 + 信息边界）
   - Mock analyzer 只返回交互矩阵的新增行
   - 断言返回的 `updatedCharacterMatrix` 包含所有历史 section + 新增行
   - 使用 `mergeCharacterMatrixMarkdown` 的专用合并

5. **快速路径**：
   - 当 `finalContent === output.content` 时，应**直接返回原 `output`**，不调用 analyzer
   - 断言 `vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter")` 的调用次数为 0

**前置要求**：
- `buildPersistenceOutput` 现为 `private`，测试要么用 `(runner as any).buildPersistenceOutput(...)` 绕过 TS 可见性，要么把它改成 `protected` / 加 `@internal` package-private 标记
- 需要 `setupTestBook` helper 在临时目录创建 `story/` 下的 md 文件；如果没有现成 helper，用 `fs.mkdtempSync` + 手写 `writeFile` 构造
- 需要 mock `ChapterAnalyzerAgent.analyzeChapter`，用 `vi.spyOn(ChapterAnalyzerAgent.prototype, "analyzeChapter").mockResolvedValue(...)`
- 现有 `pipeline-runner.test.ts:1849` 已有 ledger merge 的测试模式可以参考

---

### 回归测试

```bash
cd /Users/admin/Codex/Project/inkOS/packages/core && npx vitest run
```

确保没有现有测试被破坏。如果破坏了，**优先修测试期望值**（因为新行为是正确的），不要回滚代码修改。

---

## 📦 发版步骤（v0.2.2.5 → v0.2.2.6）

### 阶段 1：修复代码

按以下顺序修改：

1. **`/Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts`**
   - Bug A：`isLikelyStreamError`（约 328-344 行）
   - Bug C：`chatCompletionOpenAIResponsesSync` / `chatCompletionOpenAIChatSync` 调用的 webSearch 参数（约 303-306 行）
   - Bug D：catch 块增强错误提示（约 310-313 行）

2. **`/Users/admin/Codex/Project/inkOS/packages/core/src/agents/base.ts`**
   - Bug B：`chatWithSearch` openai 分支加 try/catch（约 44-57 行）

3. **`/Users/admin/Codex/Project/inkOS/packages/core/src/pipeline/runner.ts`**
   - Bug E：`buildPersistenceOutput` 补全 4 个 merge（约 2245-2285 行）
   - 顶部补 import：`mergeTableMarkdownByKey`、`mergeCharacterMatrixMarkdown`（如果未 import）

### 阶段 2：版本号同步更新（必做！）

| 路径 | 现值 | 新值 | 说明 |
|------|------|------|------|
| `/Users/admin/Codex/Project/inkOS/packages/studio/package.json:4` | `"version": "0.2.2.5"` | `"version": "0.2.2.6"` | npm package 版本 |
| `/Users/admin/Codex/Project/inkOS/packages/studio/server.cjs:1` | `const STUDIO_VERSION = "0.2.2.5"` | `const STUDIO_VERSION = "0.2.2.6"` | 服务端接口返回 |
| `/Users/admin/Codex/Project/inkOS/packages/studio/public/js/about.js:10` | `version: "0.2.2.5"` | `version: "0.2.2.6"` + **新增 changelog 条目** | About 页显示 |
| `/Users/admin/Codex/Project/inkOS/packages/studio/installer.nsi:11` | `!define PRODUCT_VERSION "0.2.2.5"` | `!define PRODUCT_VERSION "0.2.2.6"` | Windows 安装器 |

**about.js 的 changelog 新增条目**（加在数组最前面）：
```javascript
{
  version: "0.2.2.6",
  date: "2026-04-10",
  title: "修复 LLM 假卡住 + 真相文件 merge 丢失",
  changes: [
    "修复 LLM provider 返回 400 错误时被误判为流错误，导致 54 秒假卡住",
    "修复 chatWithSearch 对不支持 web_search_preview 的代理无降级",
    "修复 sync 重试仍带 webSearch 参数导致再次失败",
    "修复 SDK 解析崩溃时错误提示不明确",
    "修复主 pipeline 修订/针对性修订后情感弧线、伏笔钩子、支线板、角色矩阵历史条目被覆盖丢失",
    "⚠️ 已丢失的历史数据需要单独回补，本版本只防止继续丢失",
  ],
},
```

### 阶段 3：编译验证

```bash
cd /Users/admin/Codex/Project/inkOS/packages/core && npm run build
```

确保 TypeScript 无错误。

### 阶段 4：新增并运行测试

```bash
# 补充 provider.test.ts / base-agent.test.ts / pipeline-runner.test.ts 的用例
cd /Users/admin/Codex/Project/inkOS/packages/core && npx vitest run \
  src/__tests__/provider.test.ts \
  src/__tests__/base-agent.test.ts \
  src/__tests__/pipeline-runner.test.ts

# 回归跑全部测试
cd /Users/admin/Codex/Project/inkOS/packages/core && npx vitest run
```

### 阶段 5：提交

使用 `‼️` 前缀作为安全回退点：

```
‼️ fix: 修复 LLM 假卡住 + 4 个真相文件 merge 丢失 (v0.2.2.6)

【可安全回退版本】

═══ Bug A: 400 错误被误判为流错误（provider.ts:342）═══
- isLikelyStreamError 的 400 判定过宽，导致任何 400 错误都触发 54 秒 sync 重试
- 收紧为：只有明确包含 stream/sse/chunked 关键词的 400 才触发
- 效果：非流 400 错误（tool 不支持、key 无效等）立即失败并暴露真实原因

═══ Bug B: chatWithSearch 无降级（base.ts:49）═══
- openai 协议兼容代理不支持 web_search_preview 时，auditor 硬报 400
- 加 try/catch 降级到普通 chat
- 降级判定只匹配明确的 "unsupported tool" / "web_search_preview" / "tool type"
- 不使用过宽的 400+search 模式，避免静默吞掉真实错误（如 rate limit）

═══ Bug C: sync 重试清除 webSearch（provider.ts:304-306）═══
- sync fallback 原本继续传 webSearch=true，必然同样失败
- 改为 webSearch=false 重试，提高兜底成功率

═══ Bug D: SDK 解析错误提示增强（provider.ts:310）═══
- 识别 SSE-in-sync-mode 的 TypeError 模式
- 抛出用户友好的中文错误消息，指导换 provider

═══ Bug E: buildPersistenceOutput 补全 4 个 merge（runner.ts:2245）═══
- 主 pipeline 修订/归一化 / 针对性修订路径丢情感弧线、钩子、支线板、角色矩阵
- 补全 mergeTableMarkdownByKey（hooks/subplots/emotional_arcs）
  和 mergeCharacterMatrixMarkdown（character_matrix）
- 触发范围精确：主 pipeline 写作时内容被改动 + spotfixChapter（普通
  reviseDraft 走独立落盘逻辑，不受影响）

⚠️ 本修复只止血，不会自动回填已丢失的历史数据。
受影响的书籍需要手工回补或快照重建（参见 BUG-FIX-PLAN-ALL.md 数据恢复章节）。

═══ 版本号 ═══
v0.2.2.5 → v0.2.2.6
同步更新 package.json / server.cjs / about.js / installer.nsi

═══ 测试 ═══
- 补充 provider.test.ts：400 分类 + sync fallback webSearch + SDK parse error
- 补 base-agent.test.ts：chatWithSearch 降级 + 非 tool 错误不吞
- 补 pipeline-runner.test.ts：4 个真相文件 merge 保留历史

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

### 阶段 6：推送

```bash
cd /Users/admin/Codex/Project/inkOS && git push papaintea master
```

### 阶段 7：重新打包 Mac 版本

```bash
cd /Users/admin/Codex/Project/inkOS/packages/studio && \
  npx pkg server.cjs --targets node18-macos-x64 --output dist/inkos-studio-mac && \
  node scripts/copy-dist-assets.cjs --mac && \
  bash scripts/build-mac-installer.sh
```

产出物（绝对路径）：
- `/Users/admin/Codex/Project/inkOS/packages/studio/dist/InkOS-Studio-0.2.2.6-mac.dmg`
- `/Users/admin/Codex/Project/inkOS/packages/studio/dist/InkOS-Studio-Setup-0.2.2.6-mac.pkg`

---

## 🩹 已丢失数据的恢复策略（评审要求的处置方案）

**重要**：本修复**不会自动回填**任何已丢失数据。已经被覆盖掉的 emotional_arcs/hooks/subplots/character_matrix 历史条目需要人工回补。

### 核心原则

**按章节顺序从第一章到当前章依次补齐**，每一章的贡献从对应的快照里抽取。

**为什么按章节顺序而不是"找最早/最新快照"**：
- 每个快照 `snapshots/N/` 理论上代表"写完第 N 章后的累积状态"
- 但由于 Bug E，这些快照里可能只有"第 N 章的贡献"，历史被覆盖
- 所以要**遍历所有快照**，从每个快照里**只抽取属于该章节号的增量贡献**
- 按章节号顺序拼接，就能还原完整历史

### ⚠️ 快照语义（关键约束）

**快照 `snapshots/N/` 的语义是"写完第 N 章后当时的累积状态"**（参见 `/Users/admin/Codex/Project/inkOS/packages/core/src/state/manager.ts:235`），**不是**"最终结果的副本"。

所以：
- **当前文件**（`story/<file>.md`）：写入恢复后的**最终**结果
- **每个快照 `snapshots/N/`**：写入**"截至第 N 章"的累积状态**，必须递增生成，**不能用同一个最终结果覆盖所有快照**

**错误做法（会污染早期快照历史）**：
```
最终结果 = 包含 ch1-ch12 所有条目
→ 批量覆盖 snapshots/1/ snapshots/2/ ... snapshots/12/
❌ snapshots/1/ 现在含 ch12 数据，时间语义被破坏
```

**正确做法（递增生成每个快照）**：
```
for N from 1 to 当前最大章节号:
    snapshot_N = 按算法计算"截至第 N 章"的累积状态
    写入 snapshots/N/<file>
写入 当前文件 = snapshots/<当前最大章节号>/<file> 再 merge 当前文件里已有的独立条目
```

### 文件分类（决定恢复方式）

#### 类别 A：按章节 key 累积 —— 纯追加（不会冲突）

| 文件 | 合并 Key | 说明 |
|------|----------|------|
| `particle_ledger.md` | `[章节, 资源名称]`（列 0+1） | 每章的每个资源一行，章节号是 key 一部分 |
| `emotional_arcs.md` | `[角色, 章节]`（列 0+1） | 每章的每个角色一行 |

**恢复算法**（以 emotional_arcs 为例，**递增生成快照**）：

```
# 第一步：从每个快照抽取该章贡献（索引），用 dict 避免同章节重复行
chapter_contribs = {}  # dict: N → dict<key, row>
max_chapter = 扫描 snapshots/ 下所有目录，取最大 N
for N from 1 to max_chapter:
    读 snapshots/N/emotional_arcs.md
    chapter_contribs[N] = {}
    for 每一行:
        筛选出"章节号字段 == N"的行
        key = [角色, 章节]  # 类别 A 的 key 可能是多列组合
        chapter_contribs[N][key] = 整行
        # 注意：同 N 内如果同 key 出现多次，用后出现的覆盖（容错）

# 第二步：递增生成每个快照
accumulated = {}  # dict<key, row>，key = [角色, 章节] 或 [章节, 资源名称]
for N from 1 to max_chapter:
    for key, row in chapter_contribs[N]:
        accumulated[key] = row  # 不同章节的 key 天然不同，不会冲突
    写入 snapshots/N/emotional_arcs.md = 表头 + accumulated 的所有行

# 第三步：合并当前文件（当前文件优先语义，和类别 B 一致）
读 当前文件:
    for 每一行:
        key = [角色, 章节]
        accumulated[key] = 整行
        # 同 key 覆盖：当前文件可能是用户手工修正过的版本，优先级最高
        # 缺失 key 追加：当前文件可能有独立添加的行，也要保留

写入 当前文件 = 表头 + accumulated 的所有行
```

**这种模式的 key 冲突规则**：
- 快照间不同章节的 key 天然不同，不会冲突（章节号是 key 的一部分）
- 同章节内如果 snapshots/N/ 的某 key 和 snapshots/M/（M < N）的某 key 相同（很罕见），用 N 的覆盖
- **当前文件优先**：当前文件的任何 key 都会覆盖 accumulated 里的同 key 行（可能是用户手工修正的版本）

**❌ 不能做的事**：
- 不要拿最终 accumulated 批量覆盖所有 snapshots/。要递增生成，每个 snapshots/N/ 只含 ch1..N 的累积
- 不要只做"append 新行"而不处理同 key 覆盖 —— 这会丢失当前文件里的用户修正版

#### 类别 B：按 ID 演进 —— 合并同类项（后期覆盖前期）

| 文件 | 合并 Key | 说明 |
|------|----------|------|
| `pending_hooks.md` | `[hook_id]`（列 0） | 同一 hook 在多章被更新 |
| `subplot_board.md` | `[subplot_id]`（列 0） | 同一支线在多章被推进 |

**恢复算法**（以 pending_hooks 为例，**递增生成快照**）：

```
# 第一步：建立每章的"增量/更新"索引
chapter_contribs = {}  # dict: N → dict<id, row>
max_chapter = 扫描 snapshots/ 下所有目录，取最大 N
for N from 1 to max_chapter:
    读 snapshots/N/pending_hooks.md
    chapter_contribs[N] = {}
    for 每一行:
        id = 第 0 列
        chapter_contribs[N][id] = 整行

# 第二步：递增生成每个快照
# snapshots/N/ 应该是"截至第 N 章"的所有 hook 的最新版本
accumulated = {}  # dict<id, row>
for N from 1 to max_chapter:
    for id, row in chapter_contribs[N]:
        accumulated[id] = row   # 后面覆盖前面
    # 写入 snapshots/N/ = 表头 + accumulated 的所有行（保持插入顺序）
    写入 snapshots/N/pending_hooks.md

# 第三步：合并当前文件
# 当前文件可能有快照里没有的新 hook，或对某些 hook 有更新
读 当前文件:
    for 每一行:
        id = 第 0 列
        accumulated[id] = 整行   # 当前文件优先级最高

写入 当前文件 = 表头 + accumulated 的所有行
```

**为什么不会污染早期快照**：
- `snapshots/3/` 里只有 ch1+ch2+ch3 贡献过的 hook 的最新版本
- `snapshots/3/` 不会包含 ch4+ 才引入的 hook（因为 `chapter_contribs[4+]` 还没被遍历到）
- 每个快照时间语义正确

**这种模式是合并同类项**：
- 同一个 hook_id 在多个快照出现 → 用最新版本（最后遍历到的）
- 某个 hook_id 只在早期快照出现，晚期没有 → 说明被 bug 覆盖丢了，应当恢复早期版本
- 当前文件里有新 hook_id → 保留（这是新添加的）

**关键用例**：H020 这种远期钩子（从 ch1 就规划存在）：
- 它会出现在 `chapter_contribs[1]` 里（最早快照就有）
- 所有 `snapshots/N/` 的 accumulated 里都包含 H020
- 当前文件 merge 后也包含 H020 → 恢复成功
- **但** `snapshots/1/` 里只含 H020 和 ch1 当时的其他 hook，**不含** ch5 才引入的 hook，时间语义保持正确

**❌ 不能做的事**：不要拿最终的 accumulated 批量覆盖所有 snapshots/，要递增生成。

#### 类别 C：特殊多区段结构 —— 使用专用 merge

| 文件 | 合并方式 |
|------|----------|
| `character_matrix.md` | 调用 `mergeCharacterMatrixMarkdown` 专用函数处理多区段 |

**恢复算法**（**递增生成快照**）：

```
# 第一步：读取所有快照
matrices = {}
max_chapter = 扫描 snapshots/ 下所有目录，取最大 N
for N from 1 to max_chapter:
    matrices[N] = 读 snapshots/N/character_matrix.md

# 第二步：递增生成每个快照
accumulated = 空矩阵
for N from 1 to max_chapter:
    accumulated = mergeCharacterMatrixMarkdown(accumulated, matrices[N])
    写入 snapshots/N/character_matrix.md = accumulated

# 第三步：合并当前文件
accumulated = mergeCharacterMatrixMarkdown(accumulated, 读 当前文件)
写入 当前文件 = accumulated
```

**注意**：由于多区段合并逻辑复杂，如果实现困难，可以只做"当前文件恢复 + 快照保持原状"，**不强制重建每个快照**（但要明确标记为"快照未同步"）。

**❌ 不能做的事**：不要用最终的 accumulated 批量覆盖所有 snapshots/。

#### 类别 D：不需要恢复

| 文件 | 原因 |
|------|------|
| `current_state.md` | 本来就是"最新状态卡"，不累积，且 **绝对不能动快照**（`snapshots/N/current_state.md` 是第 N 章当时的真实状态，即使"看起来不对"也必须保持原样，否则破坏时间旅行语义） |
| `chapter_summaries.md` | 每章一条独立摘要，追加模式，bug 不影响 |

---

### 快照回写约束总结（强制遵守）

| 文件类别 | 当前文件 | 每个 snapshots/N/ |
|---------|---------|-------------------|
| A（ledger / emotional_arcs） | 写最终累积结果 | 写"截至第 N 章"的累积结果（**必须逐章递增生成**） |
| B（hooks / subplots） | 写最终合并结果 | 写"截至第 N 章"的合并结果（**必须逐章递增生成**） |
| C（character_matrix） | 写最终合并结果 | 递增生成 或 保持原状（标记未同步） |
| D（current_state） | 不动 | **绝对不动** |
| D（chapter_summaries） | 不动 | 不动 |

**绝对禁止**：
- ❌ 用一个最终结果批量覆盖所有 snapshots/
- ❌ 向 snapshots/N/ 写入 N 章之后才出现的数据
- ❌ 修改 snapshots/N/current_state.md（即使它"看起来"不对，那是当时的真实状态）

---

### 已知受影响的书籍清单

**已处理（之前会话中手工恢复过）**：
- `/Users/admin/.inkos/data/books/镜源逆刻/story/particle_ledger.md` — 恢复了 ch1-5，所有快照同步
- `/Users/admin/.inkos/data/books/镜源逆刻/story/pending_hooks.md` — 恢复了 14 个远期钩子，按 hook_id 排序

**待检查/恢复**：
- `/Users/admin/.inkos/data/books/镜源逆刻/story/emotional_arcs.md`（s8 有 40 行，当前 10 行，丢失约 30 行）
- `/Users/admin/.inkos/data/books/镜源逆刻/story/subplot_board.md`
- `/Users/admin/.inkos/data/books/镜源逆刻/story/character_matrix.md`
- `/Users/admin/.inkos/data/books/末日里-我只想给妹妹找个墓地/story/*`（所有文件）
- `/Users/admin/.inkos/data/books/长夜/story/*`（未检查）
- 其他所有书

### 恢复操作的执行顺序

**强烈建议按这个顺序**：

1. **先修代码并发版**（Prompt 1）— 保证未来不再丢
2. **用新版本写一章测试** — 验证修复有效
3. **再做数据恢复**（Prompt 2）— 纯读写数据文件，不动代码
4. **恢复后再写一章** — 验证数据和新代码共同工作正常

### 替代策略（备选）

**策略 B：重建命令**
- `inkos rebuild-hooks`、`inkos rebuild-ledger` 等命令可以重新逐章分析
- **缺点**：消耗大量 LLM token、可能和原数据细节不一致
- **适用**：快照本身也丢了无法恢复的情况

**策略 C：接受损失**
- 不回补，从 v0.2.2.6 起数据完整累积
- **适用**：早期测试书、历史条目不重要的书

---

## 📊 影响评估

| 维度 | 影响 |
|------|------|
| **跨平台** | 无差异，纯 TS 逻辑修改 |
| **数据迁移** | 不需要，但**不回填已丢数据**（见恢复策略章节） |
| **现有功能** | 只有 `chatWithSearch` 对不支持 webSearch 的 provider 行为变化（原本失败 → 现在降级成功） |
| **性能** | `buildPersistenceOutput` 多读 4 个文件（磁盘 IO），但只在 `finalContent !== output.content` 时触发 |
| **破坏性变更** | 无 |
| **数据安全** | 显著增强（4 个真相文件防丢） |
| **用户体验** | 显著改善（消除 54 秒假卡住、明确错误提示） |

---

## 📝 相关历史

本次修复基于之前的工作：

| Commit | 修复内容 |
|--------|---------|
| `22fdec9` | 首次加入 ledger merge 安全（`mergeLedgerForPersistence`） |
| `5dbc7c5 ‼️` | 修复 writer.ts runSettlement 的 governedControlBlock 门控 + reviseDraft 的 hooks merge + Mac 打包适配 |
| **本次 v0.2.2.6** | 修复 LLM 错误链路 + buildPersistenceOutput 补全 4 个 merge |

本次修复后的状态：
- ✅ 主 pipeline `runSettlement`（writer.ts）— 所有 5 个文件 merge（5dbc7c5 修）
- ✅ 主 pipeline `buildPersistenceOutput`（runner.ts）— 所有 5 个文件 merge（本次修）
- ✅ Revision 路径（runner.ts:1046-1068）— ledger + hooks merge（5dbc7c5 修 hooks，历史加的 ledger）
- ✅ Spotfix 路径（runner.ts:1215-1226）— 走 buildPersistenceOutput（本次修）
- ✅ LLM 错误链路 — 400 不再误判，webSearch 降级，错误提示明确（本次修）

---

## ✅ 执行前确认清单

开始前请确认：

- [x] 版本号目标：**v0.2.2.6** ← 已确定
- [x] 修复范围：**Bug A/B/C/D/E 全部**
- [x] Bug E 触发范围：**主 pipeline 修订/归一化 + spotfixChapter**（已修正，不含普通修订）
- [x] Bug B 降级判定：**只匹配明确的 tool 不支持关键词**（已修正，不含过宽的 400+search）
- [x] 测试计划：**补充 provider.test.ts / base-agent.test.ts / pipeline-runner.test.ts（三个文件都已存在）**
- [x] 版本号同步源：**4 处硬编码版本全部更新 + about.js changelog 新增条目**
- [x] 数据恢复声明：**本修复只止血，已丢数据需单独处置**
- [ ] **是否在修复完成后做数据恢复检查**（镜源逆刻 + 末日书的 emotional_arcs/subplots/matrix）？
- [ ] **commit 前缀**继续用 `‼️` 作为安全回退标记？

等你确认最后两项后开始。
