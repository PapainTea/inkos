# inkOS —— 项目上下文（给 Claude Code 的常驻记忆）

> 本文件是 fork `PapainTea/inkos` 的专用项目指引。上游是 `Narcooo/inkos`，本 fork 已经**显著发散**（schema / prompt / 合并逻辑都有差异），**不要尝试同步上游**。
>
> 本文件是**项目常识**，不是"当前正在讨论的细节"。细节在 `output/SESSION-FOLLOWUP-*.md`（gitignored，仅本地）。

---

## 1. 项目一句话概述

**inkOS 是一个多 agent AI 网络小说写作流水线**。用户（作者）通过 CLI 或 Studio（本地 web UI）指挥一组 LLM agent 逐章创作长篇小说，同时维护一套严格的世界状态（真相文件）。

**目标读者**：严肃长篇中文网文作者。用户 `PapainTea` 是主要维护者，正在用这个工具写 2 本书：**镜源逆刻**（12 章）和 **长夜**（1 章）。

**核心价值主张**：
1. 多 agent 协作保证写作质量（不是单次 LLM 调用）
2. 真相文件保证长篇一致性（状态卡 / 账本 / 伏笔 / 支线 / 情感弧 / 角色矩阵 / 章摘要）
3. 快照系统支持回滚、修订、数据恢复

---

## 2. 架构速览

### 2.1 Monorepo 结构

```
packages/
├── core/          # LLM pipeline 核心，所有 agent 代码，约 80% 的代码量在这
│   ├── src/
│   │   ├── agents/       # 各个 LLM agent 及其 prompt
│   │   ├── pipeline/     # runner.ts 主流程 + pipeline-cache + detection-runner
│   │   ├── state/        # manager.ts 快照 + state-bootstrap + runtime-state-store
│   │   ├── utils/        # merge / filter / hook-governance / governed-context 等
│   │   ├── models/       # TypeScript 类型定义
│   │   └── llm/          # provider.ts (OpenAI / Anthropic 等统一封装)
│   └── dist/             # tsc 输出（打包时使用）
├── cli/           # inkos CLI (inkos write, inkos revise, inkos write rewrite 等)
│   └── src/commands/     # 各个子命令
└── studio/        # 本地 GUI
    ├── server.cjs        # Node HTTP server + SSE + CLI 执行代理
    ├── public/           # 前端 HTML/CSS/JS (book-manage / editor / content / pipeline)
    ├── installer.nsi     # Windows NSIS 安装脚本
    └── scripts/          # Mac 打包脚本
```

### 2.2 Agent 角色和职责（按 pipeline 顺序）

每个 agent 在 `packages/core/src/agents/` 下。用户看"产品功能"而不是代码细节：

| Agent | 用途（产品层面）| 什么时候被调用 | 关键 prompt 文件 |
|---|---|---|---|
| **architect** | 初始化新书：生成 story_bible / volume_outline / book_rules / 初始 truth files scaffold | 用户点"新建书"时 | `architect.ts` |
| **planner** | 生成当前章节的 chapter intent（章意图）| governed mode 写新章前 | `planner.ts` |
| **composer** | 合成 context package + rule stack | governed mode 写新章前 | `composer.ts` |
| **writer** | 撰写章节草稿 + 产出 runtime state delta + 5 个真相文件更新 | 每次写新章 | `writer-prompts.ts` |
| **length-normalizer** | 字数归一化（压缩/扩展到目标字数） | 写完草稿后，条件化运行 | `length-normalizer.ts` |
| **continuity**（auditor） | 审稿：OOC / 信息越界 / 设定冲突 / 战力崩坏 / 节奏 / 词汇疲劳 | 写完/修订后 | `continuity.ts` |
| **reviser** | 修订章节。有 5 种模式（详见 §4.1）| audit 失败或用户手动触发 | `reviser.ts` |
| **chapter-analyzer** | 分析已写章节，提取状态变化输出所有真相文件更新 | `rebuildLedger` / `rebuildHooks` / 重建流程 | `chapter-analyzer.ts` |
| **settler** | 结算本章状态变化，输出 runtime state delta | 写章流程末尾 | `settler-prompts.ts` |
| **titler** | 生成章节标题 | 写完正文后 | `writer-prompts.ts buildTitlerPrompt` |
| **post-write-validator** | 写后校验：敏感词 / AI 痕迹 / meta-leak | 写完后 | `post-write-validator.ts` |
| **detector / radar** | AI 生成痕迹检测和反检测指标计算 | 独立检测命令或 anti-detect 模式 | `detector.ts / radar.ts` |
| **observer** | 状态观察者（辅助 settler 提取事实）| settler 之前 | `observer-prompts.ts` |

### 2.3 Pipeline 入口（主要在 `packages/core/src/pipeline/runner.ts`）

| 公共方法 | 作用 | 锁 |
|---|---|---|
| `writeNextChapter(bookId, wordCount?, temp?, opts?)` | 写下一章（主入口）| 自动获取 |
| `_writeNextChapterLocked(...)` | 内部实现（假设 lock 已持有）| 无 |
| `reviseDraft(bookId, chapterNum?, mode, opts?)` | 修订某章（5 种模式，rework 走特殊路径）| 自动获取 |
| `spotfixChapter(bookId, chapterNum, callbacks?)` | 高层 spot-fix 封装 | 自动获取 |
| `rebuildLedgerFromChapters(bookId, opts?)` | 从所有章节正文重建资源账本 | 自动获取 |
| `rebuildHooksFromChapters(bookId, opts?)` | 从所有章节正文重建伏笔池 | 自动获取 |
| `refreshMemoryFromRestoredState(bookId, fallbackChapter)` | 重建 memory.db（从恢复后的 markdown）| 无 |

### 2.4 数据存储布局

```
项目代码：
/Users/admin/Codex/Project/inkOS/          # 仓库根

用户书籍数据（不在 git 里）：
~/.inkos/data/books/<书名>/
├── story/
│   ├── particle_ledger.md      # 资源账本（7 列含事件ID）
│   ├── emotional_arcs.md       # 情感弧线
│   ├── pending_hooks.md        # 伏笔池
│   ├── subplot_board.md        # 支线进度板
│   ├── character_matrix.md     # 角色交互矩阵（3 子表）
│   ├── chapter_summaries.md    # 章节摘要
│   ├── current_state.md        # 当前状态卡
│   ├── story_bible.md          # 世界观（用户手写）
│   ├── volume_outline.md       # 卷纲（用户/architect 生成）
│   ├── book_rules.md           # 本书规则
│   ├── author_intent.md        # 作者意图
│   ├── current_focus.md        # 当前聚焦
│   ├── memory.db               # SQLite 事实索引
│   ├── runtime/                # 运行时缓存
│   ├── state/                  # 结构化 state JSON
│   ├── logs/                   # pipeline 运行日志
│   └── snapshots/<N>/          # 每章写完后的完整快照
│       ├── particle_ledger.md
│       ├── emotional_arcs.md
│       ├── pending_hooks.md
│       ├── subplot_board.md
│       ├── character_matrix.md
│       ├── chapter_summaries.md
│       ├── current_state.md
│       └── state/
└── chapters/
    ├── 0001_<title>.md         # 正文
    ├── 0002_<title>.md
    ├── ...
    └── index.json              # 章节索引（含 status / wordCount / lengthTelemetry 等）
```

---

## 3. 真相文件深度说明（核心概念）

### 3.1 7 个真相文件清单

每本书的 `story/` 目录下有 7 个"真相文件"（truth files），是世界状态的持久化层。它们的 schema 和合并语义各不相同，**搞混了会引发数据丢失**。

| 文件 | 中文名 | Schema | 字段清单 | 合并 key | Pipeline 写入点 |
|---|---|---|---|---|---|
| `particle_ledger.md` | **资源账本** | 7 列（v0.2.2.6+）| 章节 / 资源名称 / 期初 / 变动 / 期末 / 事由 / **事件ID** | `[6]` 事件ID | writer.saveChapter / reviser / analyzer / rebuildLedger |
| `emotional_arcs.md` | **情感弧线** | 6 列 | 角色 / 章节 / 情绪状态 / 触发事件 / 强度(1-10) / 弧线方向 | `[0, 1]` 角色+章节 | writer.saveChapter / analyzer |
| `pending_hooks.md` | **伏笔池** | 7 列 | hook_id / 起始章节 / 类型 / 状态 / 最近推进 / 预期回收 / 备注 | `[0]` hook_id | writer / reviser / analyzer / rebuildHooks |
| `subplot_board.md` | **支线进度板** | 9 列 | 支线ID / 支线名 / 相关角色 / 起始章 / 最近活跃章 / 距今章数 / 状态 / 进度概述 / 回收ETA | `[0]` 支线ID | writer.saveChapter / analyzer |
| `character_matrix.md` | **角色交互矩阵** | **3 子表**（`### 角色档案` + `### 相遇记录` + `### 信息边界`）| 见 §3.3 | 3 个子 key：`[0]` / `[0, 1]` / `[0, 3]` | writer.saveChapter / analyzer |
| `chapter_summaries.md` | **章节摘要** | 8 列 | 章节 / 标题 / 出场人物 / 关键事件 / 状态变化 / 伏笔动态 / 情绪基调 / 章节类型 | `[0]` 章节（**append**，有已知 bug）| writer.saveChapter（有 bug，见 §4.3）|
| `current_state.md` | **当前状态卡** | 字段键值表 | 字段 / 值（章节/位置/主角状态/当前目标/当前限制/当前敌我/当前冲突）| 整体覆盖 | 每章覆盖 |

### 3.2 资源账本 7 列 schema（v0.2.2.6 新增）

`particle_ledger.md` 的每一行记录一次资源变动。v0.2.2.6 之前是 6 列，之后加了第 7 列 `事件ID` 作为合并 key。

**示例**：

```markdown
# 资源账本

| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |
|------|----------|------|------|------|------|--------|
| 0 | - | 0 | 0 | 0 | 开书初始 | init-0 |
| 1 | 灵石 | 0 | +50 | 50 | 初次采矿 | ch1-灵石-1 |
| 4 | 情报权 | 27 | +1 | 28 | 顾家再次来人 | ch4-情报权-1 |
| 4 | 情报权 | 28 | +1 | 29 | 周巡事查明旧库少失 | ch4-情报权-2 |
| 4 | 情报权 | 29 | +1 | 30 | 旧单缺失意味内鬼 | ch4-情报权-3 |
```

**事件ID 规则（LLM 被要求遵守）**：
- **初始化行**：用 `init-0`
- **常规事件**：`ch{章节}-{资源名}-{序号}`，序号在同 (章节, 资源) 组合内递增
- **修正已有事件**：**必须复用**原 事件ID，不要生成新的（prompt 里有硬性要求）
- **新增事件**：序号取当前未使用的下一个

**自动兜底**：LLM 忘填或老 6 列数据遇到 `normalizeLedgerMarkdown` 时，会用内容哈希生成 `auto-ch{章节}-{hash6}`，稳定可合并。格式：`auto-ch4-a1b2c3`。

**两种 ID 格式混存 OK**：merge 层按字符串相等判断，不在意格式。

### 3.3 角色交互矩阵 3 子表结构

`character_matrix.md` 必须是 3 个 `### ` 分隔的子表：

```markdown
# 角色交互矩阵

### 角色档案
| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |
|------|----------|----------|----------|----------|------------|----------|----------|
| 顾悬 | ... |
| 周巡事 | ... |

### 相遇记录
| 角色A | 角色B | 首次相遇章 | 最近交互章 | 关系性质 | 关系变化 |
|-------|-------|------------|------------|----------|----------|
| 顾悬 | 周巡事 | 1 | 12 | ... |

### 信息边界
| 角色 | 已知信息 | 未知信息 | 信息来源章 |
|------|----------|----------|------------|
| 顾悬 | 乙九流程号含义 | 门外观察者身份 | 4 |
```

**Section 的合并 key**（`mergeCharacterMatrixMarkdown` 硬编码）：
- Section 0（角色档案）：`[0]` = 角色名
- Section 1（相遇记录）：`[0, 1]` = 角色对
- Section 2（信息边界）：`[0, 3]` = 角色 + 信息来源章

**⚠️ 如果遇到扁平单表格式**：`mergeCharacterMatrixMarkdown` 对没有 `### ` 的文件直接 `return updated`（no-op），相当于不合并。镜源逆刻之前的 character_matrix 就是扁平的，2026-04-11 已重建。fallback 修复见 §6 TODO。

### 3.4 快照系统（Snapshots）

**语义约定**：`story/snapshots/N/` 是"**写完第 N 章之后当时的累积状态**"，不是"最终结果的副本"。

**硬性约束（任何数据恢复脚本都要遵守）**：
1. 绝不向 `snapshots/N/` 写入 N 章之后才出现的数据
2. 绝不批量用一个最终结果覆盖所有快照
3. 绝不修改 `snapshots/N/current_state.md`（它是当时的真实状态卡）
4. 恢复/重建时必须逐章"递增生成"每个快照

**典型操作**：
- `state.snapshotState(bookId, N)`：写完 ch N 后保存快照
- `state.restoreState(bookId, N)`：从快照恢复到 ch N 的状态（rework 模式 + CLI rewrite 命令用）

---

## 4. Reviser 的 5 种模式（语义要搞清楚）

### 4.1 5 种模式对照

| 技术名 | 中文名 | 改动幅度 | 典型用途 | 持久化写入 |
|---|---|---|---|---|
| `spot-fix` | **定点修复** / 针对性修订 | 单句或段落 | 修 1-2 个问题句 | state + ledger + hooks（3 文件）|
| `polish` | **润色** | 表达 / 节奏 | 改文字美感 | 同上 |
| `rewrite` | **改写** | 段落级重组 | 问题段落重组 | 同上 |
| `rework` | **重写** | 整章重生成 | 推翻重写 | **restoreState(N-1) + writeNextChapter 全流程**（7 文件都会更新）|
| `anti-detect` | **反检测** | AI 痕迹清洗 | 降 AI 检测指标 | state + ledger + hooks |

**关键**：
- **4 个 partial-patch 模式**（spot-fix / polish / rewrite / anti-detect）只写 3 个 state 文件（state + ledger + hooks），**不碰** 4 个真相文件（subplots / emotional_arcs / character_matrix / chapter_summaries）
- **rework 单独分支**（2026-04-11 新增）：恢复到上一章快照 → 删除 ch ≥ N 的正文和 index → 重跑 writeNextChapter，完整 pipeline 生成新内容

**Rework 模式的 7 步完整流程**（见 `runner.ts:reworkChapterFromPreviousSnapshot`）：
1. 预校验 `snapshots/(N-1)/` 有 current_state.md 和 pending_hooks.md
2. `restoreState(N-1)` 恢复所有真相文件
3. 删除 `chapters/000N_*.md` 以及所有 > N 的章节文件
4. 从 chapter index 删除 ch ≥ N 的条目
5. 清理 `pipeline-cache/N/` 避免 stale cache
6. `refreshMemoryFromRestoredState(N-1)` 重建 memory.db
7. 调 `_writeNextChapterLocked` 跑完整 write 流程（book lock 已持有，直接调 locked 版本）

### 4.2 Reviser 实际读写的文件矩阵（容易搞错的细节）

Reviser 的上下文：

**Reviser 实际读**（`reviser.ts:77-88`）：
- ✅ `current_state.md`
- ✅ `particle_ledger.md`
- ✅ `pending_hooks.md`
- ✅ `style_guide.md`（或 book_rules 的 body fallback）
- ✅ `volume_outline.md`
- ✅ `story_bible.md`
- ✅ `character_matrix.md`
- ✅ `chapter_summaries.md`
- ✅ `parent_canon.md`（fanfic 模式）
- ✅ `fanfic_canon.md`（fanfic 模式）

**Reviser 不读**（重要！）：
- ❌ `subplot_board.md`
- ❌ `emotional_arcs.md`

**Reviser 的 outputFormat 只要求 LLM 输出**：
- ✅ `UPDATED_STATE`
- ✅ `UPDATED_LEDGER`（通过 `ledgerSchemaInstruction`）
- ✅ `UPDATED_HOOKS`

**不要求输出**（v0.2.2.6 盲点）：
- ❌ `UPDATED_SUBPLOTS`
- ❌ `UPDATED_EMOTIONAL_ARCS`
- ❌ `UPDATED_CHARACTER_MATRIX`
- ❌ `UPDATED_CHAPTER_SUMMARIES`

**Reviser 的持久化段**（`runner.ts:reviseDraft:1047-1068`）只写：
- `current_state.md`（覆盖）
- `particle_ledger.md`（经 `mergeLedgerForPersistence` 合并）
- `pending_hooks.md`（经 `mergeTableMarkdownByKey` 合并）

**结论**：partial-patch 模式下，即使 reviser 改动的正文影响了支线/情感/角色关系/章节摘要，这 4 个真相文件也**不会被同步**。这是用户担心的"spot-fix 不一致性"问题的根源。解决方案见 §6 TODO P1-A。

### 4.3 Bug E 的三层覆盖范围（重要！）

**什么是 Bug E**：一句话概括：**LLM 输出不完整时，真相文件应该被保留而不是覆盖丢失**。

Bug E 在不同地方被修复了三次（或说在 3 个层面上）：

| 修复层面 | 覆盖路径 | commit | 状态 |
|---|---|---|---|
| **第一层**（b75ddc9）| `runner.ts:buildPersistenceOutput`（analyzer 路径）| b75ddc9 | ✅ 已修 |
| **第二层**（b75ddc9 + 本 session 补）| `runner.ts:reviseDraft` 持久化段 | b75ddc9 + 56d8421 | ✅ 已修 |
| **第三层**（未修，**P1 待办**）| `writer.ts:saveChapter` 和 `saveChapterFromWriterOutput` 的 4 文件直接覆盖路径 | - | ❌ **未修** |

**第三层是为什么 chapter_summaries 会丢 ch5/7/9/11 的根源**：不是 reviser 改的，是 writer 新建章节时 saveChapter 直接整体覆盖 chapter_summaries.md 造成的。同理 emotional_arcs / subplot_board / character_matrix 在 writer 主流程里也会被覆盖。

### 4.4 Character_matrix fallback 问题（已修 2026-04-11 `ed0e77c`）

**历史问题**：`mergeCharacterMatrixMarkdown`（`utils/governed-working-set.ts`）对**扁平单表**（没有 `### ` section）的文件原本是 no-op（直接 `return updated`），会导致 3-sub current + flat incoming 场景下 current 数据被 wiped。

**修复方式**：改 `mergeCharacterMatrixMarkdown` 按两侧 section 数量分 4 种情况处理：
- 两边都 3-sub → 原按 section + key cols 合并
- 两边都 flat → `mergeTableMarkdownByKey(a, b, [0])` 按角色名单列合并
- current 3-sub + incoming flat → **保留 current**（拒绝 schema 回退，防止 regression 覆盖历史）
- current flat + incoming 3-sub → 返回 incoming（schema 升级路径）

测试覆盖：`packages/core/src/__tests__/governed-working-set.test.ts` 新增 3 个测试（flat/flat 合并、3-sub preserve、flat → 3-sub 升级）。

---

## 5. 用户数据现状（2026-04-11 恢复后）

### 5.1 镜源逆刻（12 章）

| 文件 | 列/子表 | 数据行 | 状态 |
|---|---|---|---|
| particle_ledger.md | **7 列**（含事件ID）| 189 | ✅ schema 正确 |
| emotional_arcs.md | 6 列 | 117 | ✅ **从 9 行恢复了 108 行** |
| pending_hooks.md | 7 列 | 50 | ✅ |
| subplot_board.md | 9 列 | 23 | ✅ |
| character_matrix.md | **3 子表** | 79（含 3 个 header） | ✅ Claude 重建（非原生 LLM 产出）|
| chapter_summaries.md | 8 列 | **12（ch1-12 完整）** | ✅ ch7 由正文重生成 |
| current_state.md | 字段表 | 8 | ✅ 未触碰 |

### 5.2 长夜（1 章）

| 文件 | 列/子表 | 数据行 | 状态 |
|---|---|---|---|
| particle_ledger.md | 7 列 | 25 | ✅ |
| emotional_arcs.md | 6 列 | 5 | ✅ |
| pending_hooks.md | 7 列 | 21 | ✅ |
| subplot_board.md | 9 列 | 7 | ✅ |
| character_matrix.md | 3 子表 | 27 | ✅ 已是 3 子表，无需重建 |
| chapter_summaries.md | 8 列 | 1 (ch1) | ✅ |
| current_state.md | 字段表 | 8 | ✅ |

### 5.3 已知风险

1. **镜源逆刻 s0-s3 快照的 ledger** 是用算法按 ch<=N 过滤重建的，不是原始 legacy 数据。原始备份在 `snapshots.backup-20260411140305/` 里
2. **镜源逆刻 character_matrix** 是我（Claude）在 session 里作为 LLM 重建的，**不是原生 settler 产出**。内容准确度取决于我的推理，可能有遗漏。建议用户审阅一次
3. **镜源逆刻 chapter_summaries ch7** 是我手工基于 ch7 正文生成的，不是原生 LLM 输出。风格可能略有差异

---

## 6. 待办清单（下一个 session 请按优先级推进）

> **2026-04-11 ~ 2026-04-12 进度**：P0 / P1-A / P1-B / P3-C 全部完成（commits `788afed` / `b43f2cd` / `9d97311` / `ed0e77c`，均带日期见 §12）。Bug E 三层 + character_matrix 扁平 fallback 全部封堵。另外修了 Studio 刷新 2 bugs（`0a502f6` 2026-04-12）+ Mac 打包 libnode shim 问题（`51dab6d` 2026-04-11）。下一批优先级见下。

### 🔴 P-HOT —— Settler/Observer LLM 卡死 97 分钟（2026-04-12 发现）

**现象**：镜源逆刻 ch13 写作时，settler/observer 阶段 2b 的 LLM call 流式输出持续 **97 分钟**（5828 秒），产出 25473 字符（11642 CJK）后被 writer 层"LLM stream interrupted, using partial response"打断。实际只有 writer 第一个 LLM call（写正文）正常 4 分钟完成。

**Log 证据**：`~/.inkos/data/books/镜源逆刻/story/logs/chapter-0013-write-20260411T153530.jsonl`
```
15:35:30 UTC  pipeline 启动
15:39:32 UTC  writer 主 LLM succeeded (4661 tokens, 4 分钟，正常)
15:43:17 UTC  进入"阶段 2b：把观察结果回写到真相文件"(settler/observer)
15:43:17 UTC  settler LLM call starting (maxTokens: 8192, temperature: 0.3, stream=true)
...
17:19:59 UTC  streaming 5803s, 24634 chars (11203 CJK)  ← 流了近 97 分钟
17:20:26 UTC  ⚠️ LLM stream interrupted, using partial response (elapsedMs: 5828316)
17:20:26 UTC  repair LLM call starting (maxTokens: 4096, temperature: 0.1)
```

**根因猜测**（未实证，待下个 session 查 settler prompt）：
1. **settler prompt 上下文过大**：ch13 时已经有 12 章历史 summaries + 189 行 ledger + 50 hooks + 3 子表 character_matrix + subplot_board，全部塞进 settler 的 user prompt，可能让 LLM 在某个 token 陷入重复循环
2. **observer + settler 合并的 prompt 过于复杂**：要求 LLM 同时产出 observations + updated_state + updated_ledger + updated_hooks + updated_subplots + updated_emotional_arcs + updated_character_matrix + updated_chapter_summaries，输出格式 section 很多，某个 section 输出错误后进入死循环
3. **gpt-5.4 模型本身在这个 context 卡死**：罕见但可能

**现有兜底（writer.ts:583 `repairMissingTruthSections`）**：
- partial response 被 parser 扫过后，检测缺失的 UPDATED_XXX section
- 构造一个专门针对缺失部分的小 prompt，发起 repair call（temp 0.1 / maxTokens 4096）
- repair 成功 → 用 repair 结果填缺失 section
- repair 失败 → fallback 到磁盘原文件（保证不丢数据）
- **不阻止 2 小时 token 浪费本身**

**修复方向**（按难度递增）：

1. **快方案：settler call 加硬超时（30 分钟工作量）**
   - 在 writer.ts runSettlement 流式监听循环里加 watchdog
   - 超过 120 秒未结束直接 abort，进入 repair 流程
   - 避免 97 分钟无意义烧 token
   - 代码位置：搜 `"LLM stream interrupted"` 附近的流式处理逻辑

2. **中方案：产出字符数水位保护（1-2 小时工作量）**
   - 监控流式输出总长度，超过 20000 chars 直接 abort（settler 正常输出上限 <10k）
   - 避免 "LLM 陷入循环吐 token"的失控场景
   - 比硬超时更精准，但实现复杂度略高

3. **深方案：settler prompt 本身重构（半天工作量）**
   - 加 "END OF OUTPUT" 硬终止符 / 明确 token 上限声明
   - 拆分 observer 和 settler 为两个独立 LLM call（observer 只产 observations，settler 基于 observations 产结构化数据）
   - 每个子 call 输出范围受限，不易陷入循环

**实际优先级**：P-HOT。单次 incident 浪费用户 2 小时 + 大量 token 费用，体验灾难级。**下个 session 应立刻做"快方案"**（30 分钟加 watchdog），中方案可以后续补充。

**相关代码入口**：
- `packages/core/src/agents/writer.ts`：`runSettlement` / settler LLM 调用位置
- `packages/core/src/agents/writer.ts:583 repairMissingTruthSections`：已有的 repair 兜底
- `packages/core/src/agents/settler-prompts.ts`：settler system + user prompt 构造

---

### 🟡 P2 —— 伏笔治理

**伏笔陈旧度 prompt 强化**

- **问题**：镜源逆刻 49 个 hook 只有 2 个 resolved（4%），偏低
- **现状**：
  - `hook-governance.ts` 已有 `collectStaleHookDebt` 检测陈旧 hook
  - `hook-health.ts` 会产出 "Stale hooks received no real disposition" 的 audit warning
  - 但 LLM 看不到这些 warning（它们只出现在 audit 输出里）
- **修复（温和方案）**：
  1. 在 settler user prompt 里**显式塞入** stale hook 列表："以下 hook 已经 X 章未推进"
  2. 加鼓励语："优先处理这些陈旧 hook（推进 / 延后 / 回收三选一）"
  3. **不加硬约束**（避免 LLM 为了完成指标乱 resolve 重要伏笔）
- **工作量**：30 分钟

### 🔵 P3 —— Feature 级（v0.2.3.x 独立周期）

**P3-A：滚动章纲 / 滑动窗口**

- **用户构想**：写 ch N 时，context 里应该有 "本章 + 前 3 章历史摘要 + 后 3 章规划"
- **现状**：
  - 前 3 章历史：`filterSummaries(keepRecent=5)` 已有，改成 3 就是
  - 后 3 章规划：**没有**，需要从 `volume_outline.md` 切片或新建 `chapter_window_outline.md`
- **不适合塞进 bug fix session**，需要独立 feature 周期
- **工作量**：半天以上

**P3-B：缺失的 3 个 rebuild 工具**

- **现状**：只有 `rebuildHooksFromChapters` 和 `rebuildLedgerFromChapters`
- **缺失**：`rebuildCharacterMatrix` / `rebuildSubplots` / `rebuildEmotionalArcs`
- **何时需要**：未来出现数据损坏或 schema 漂移时
- **工作量**：每个约 2-3 小时

---

## 6.5 待用户测试验证（代码已修，需真实场景验证）

以下改动代码已完成、commit 已落地、vitest + tsc 全绿（502/502），但需要用户**在真实 Studio / 写作流程中实际验证**通过后才算完全 done。验证失败要立刻回滚或加 fix-up。

### ✅ P3-C —— character_matrix 扁平单表 fallback

- **Commit**：`ed0e77c` (2026-04-11)
- **改动**：`mergeCharacterMatrixMarkdown` 按 section 数量分 4 种情况处理（两边 flat 按单列 merge / 两边 3-sub 按 section merge / 3-sub current 遇 flat incoming 保留 current / flat current 遇 3-sub incoming 升级为 incoming）
- **自动测试**：vitest 新增 3 个 flat fallback 测试 ✅（`packages/core/src/__tests__/governed-working-set.test.ts`）
- **用户待验证**：
  1. 跑一次 ch13+ 的 write 或 spot-fix，观察 `character_matrix.md` 是否被正常更新（不要被 wipe）
  2. 在 snapshots/N/ 或旧备份里复制一个**扁平格式**的 character_matrix，放到某本测试书的 story/ 里，跑一次 write，验证数据不被 3-sub LLM output wipe
  3. 观察每次 write 后 character_matrix 3 个子表（角色档案 / 相遇记录 / 信息边界）的行数是否递增而不是递减

### ✅ Studio 刷新恢复 Bug 1 —— routing race

- **Commit**：`0a502f6` (2026-04-12)
- **Bug 引入**：`d838702` (2026-03-30) feat: path router —— "/" handler 硬编码 setView("dashboard")
- **改动**：`checkPipelineStatus()` 从 `initPipeline()` 里移出，export，在 `app.js:boot` 里 `initRouter()` **之后** await 调用（严格串行，不再是 race）
- **用户待验证**：
  1. 启动 Studio，开始写一个章节
  2. 在 pipeline 运行中（任何 stage 都行）按 `Cmd+R` 刷新浏览器
  3. **期望**：自动回到"写作实况"页面，看到当前运行的 pipeline
  4. **坏版行为对比**：会落到书架（dashboard），必须手动点上方红点 / 绿点（pipeline-light）才能进 pipeline view
- **生效条件**：⚠️ 只在**开发模式 `node server.cjs`**下立刻生效；**安装版**需重新打包（`51dab6d` 的新 DMG 还未包含本 commit，需要 ch13 跑完后我重打一份）

### ✅ Studio 刷新恢复 Bug 2 —— stage 活跃状态丢失

- **Commit**：`0a502f6` (2026-04-12)
- **Bug 引入**：`a548322` (2026-03-28) feat: task state persistence 引入 events buffer trim；`626b26a` / `49d9268` (2026-04-01) + `a310e18` (2026-04-03) 加 stage + 加流式阶段让触发条件成熟
- **改动**：
  - 服务端 `recordPipelineEvent` 追踪 `task.currentStage` 字符串字段（stage-start 事件时更新，算力零）
  - 客户端 `checkPipelineStatus` replay 后如果没有 active card，用 `task.currentStage` fallback activate
- **用户待验证**：
  1. 启动 Studio，开始写一个**长章节**（让 pipeline 跑 15+ 分钟，events buffer 肯定超过 2000 触发 trim）
  2. 在 settler 阶段（或任何后期 stage）按 `Cmd+R` 刷新浏览器
  3. **期望**：pipeline view 的当前 stage 自动展开，后续 SSE content 继续正确流入该 stage 卡
  4. **坏版行为对比**：所有 stage 都显示为空折叠卡片（▶），header 显示 "流式生成中 XXXs, XXXX chars" 但内容进不来
- **已知局限**：过往已完成的 stage（events 被 trim 掉的部分）仍然是空的，只有**当前正在跑的 stage** 会展开。这个妥协是为了保持"最小改动 + 最少算力"原则
- **生效条件**：同 Bug 1，开发模式立即生效，安装版需要重打包

### ✅ Mac 打包 libnode shim 问题

- **Commit**：`51dab6d` (2026-04-11)
- **根本问题**：v0.2.2.5 及之前的 Mac 包里 `MacOS/node` 是 homebrew 的 33 KB shim（依赖 `@rpath/libnode.141.dylib`），装到没 homebrew 的 Mac 就炸 `dyld: Library not loaded`
- **改动**：`copy-dist-assets.cjs` 的 mac 分支改用 `/tmp/inkos-node-cache/node-v18.20.4-darwin-x64/bin/node` —— 官方自包含二进制
- **代价**：`MacOS/node` 从 33 KB → 87 MB，DMG 从 46 MB → 80 MB，安装后约 170 MB
- **用户待验证**：
  1. 拿新包（`InkOS-Studio-0.2.2.6-mac.dmg` 或 `.pkg`）装到**用户自己的 Mac**
  2. 启动 Studio 写章节
  3. **期望**：CLI 子进程正常 spawn，没有 `dyld: Library not loaded: @rpath/libnode.141.dylib` 报错
  4. **可选**：再找一台**没装 homebrew Node** 的 Mac 烟测一次，验证真正"独立可分发"

### ⚠️ Windows 平台未验证

- **Studio 刷新 2 bugs**：都是 ESM 前端代码，逻辑 Windows 上理论生效。下次打 Windows 包后需要跑一次刷新烟测
- **Mac 打包修复**：`copy-dist-assets.cjs` 的 mac 分支只在 `--mac` 参数下跑，Windows 路径完全未动，无 regression 风险
- **待验证**：下次打 Windows Setup.exe 前需要确认 Studio 刷新两个 bug 在 Windows 浏览器（Edge / Chrome）上也能修好

### 如何回滚

如果上述某一项验证失败，按对应 commit hash revert：
```bash
git revert <hash>  # 比如 git revert 0a502f6
# 或者针对单文件恢复旧版
git checkout <prev-hash> -- <file>
```

---

## 7. 测试和构建约定

### 7.1 测试命令

```bash
# Core 包测试（必须 cd 到 packages/core）
cd packages/core && npx vitest run

# 类型检查
cd packages/core && npx tsc --noEmit
```

**硬性要求**：任何 commit 前必须 `vitest run` 全绿（当前基线 **502/502**，2026-04-12 后）。

**⚠️ 重要**：**不要在项目根目录跑 vitest**，根目录会扫到 `packages/studio/dist/` 下的 studio UI 测试，那些在 dist 被 rebuild 时会报 module not found。**必须 cd 到 `packages/core/`**。

### 7.2 构建命令

**Mac 打包**：
```bash
cd packages/studio
npx pkg server.cjs --targets node18-macos-x64 --output dist/inkos-studio-mac
node scripts/copy-dist-assets.cjs --mac
bash scripts/build-mac-installer.sh
```
产物：
- `dist/InkOS-Studio-0.2.2.6-mac.dmg`
- `dist/InkOS-Studio-Setup-0.2.2.6-mac.pkg`

**Windows 打包**（需要 brew install makensis）：
```bash
cd packages/studio
npx pkg server.cjs --targets node18-win-x64 --output dist/inkos-studio.exe
makensis installer.nsi
```
产物：`dist/InkOS-Studio-Setup-0.2.2.6.exe`

---

## 8. Git 约定

- **Bug 修复**：用 `‼️` 前缀（比如 `‼️ fix: v0.2.2.6 补完 ...`）
- **Feature**：`feat: ...`
- **文档**：`docs: ...`
- **Chore**：`chore: ...`
- Commit message 末尾加 `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- **不要 amend 已发布的 commit**，总是创建新 commit
- **不要 push origin**（那是上游 Narcooo，无写权限）；只 push 到 `papaintea` remote
- **不要 force push**
- **不要 `--no-verify` / `--no-gpg-sign`**

### 引用 commit 时一律带日期

格式：`<hash> (YYYY-MM-DD) <subject>`

例如：
- ✅ `d838702 (2026-03-30) feat: AIGC detection settings page, path router, ...`
- ✅ `788afed (2026-04-11) ‼️ fix: reviser context filter 补齐（P0 免费午餐）`
- ❌ `d838702 feat: ...`（没日期，无法定位 bug 引入时间）

**为什么**：bug 引入通常发生在某个 commit，带日期能一眼看出 bug 年龄 / 触发窗口。

**如何取日期**：
```bash
git log -1 --format='%ad  %s' --date=format:'%Y-%m-%d' <hash>
# 或批量：
for c in hash1 hash2 hash3; do
  echo "$c  $(git log -1 --format='%ad  %s' --date=format:'%Y-%m-%d' $c)"
done
```

**适用场景**：所有用户可见的 commit 引用——bug 分析、session followup、CLAUDE.md §12、commit message 正文里引用其他 commit 的时候。

---

## 9. 核心代码路径速查

```
重要文件（按出现频率排序）：

packages/core/src/pipeline/runner.ts
    ├─ reviseDraft (L711+)             # 5 种 reviser 模式入口
    ├─ reworkChapterFromPreviousSnapshot  # rework 新语义
    ├─ _writeNextChapterLocked (L1400+)    # 主 write 流程
    ├─ buildPersistenceOutput (L2280+)     # analyzer 路径 merge 兜底
    ├─ rebuildLedgerFromChapters (L2941)
    ├─ rebuildHooksFromChapters (L2729)
    └─ refreshMemoryFromRestoredState (L2823)

packages/core/src/agents/writer.ts
    ├─ writeChapter (L100+)              # 写章节主函数
    ├─ saveChapter (L860+)               # ⚠️ 有 4 文件整体覆盖路径（P1-B）
    ├─ saveChapterFromWriterOutput       # 另一个覆盖点
    ├─ ensureTruthFileScaffolds (L1252+) # 初始 scaffold
    └─ getCharacterMatrixScaffold (L1289+) # 3 子表模板

packages/core/src/agents/reviser.ts
    ├─ reviseChapter (L64+)              # 修订入口
    ├─ outputFormat                      # ⚠️ 只覆盖 3 文件（P1-A）
    └─ parseOutput                       # ⚠️ 只解析 3 字段（P1-A）

packages/core/src/agents/settler-prompts.ts
    └─ buildSettlerSystemPrompt          # settler 系统提示词
packages/core/src/agents/writer-prompts.ts
    └─ buildWriterSystemPrompt           # writer 系统提示词（含 character_matrix 3 子表模板）
packages/core/src/agents/chapter-analyzer.ts
    └─ (ZH + EN 双语 output format)

packages/core/src/utils/truth-file-persistence.ts
    ├─ isLedgerSentinel / isStateSentinel / isHooksSentinel
    ├─ mergeLedgerForPersistence         # sentinel 检测 + 调 mergeLedgerTables
    ├─ mergeLedgerTables                 # normalize 两边 + mergeTableMarkdownByKey
    └─ normalizeLedgerMarkdown           # 6→7 自愈，含语言检测和 fallback ID 生成

packages/core/src/utils/ledger-schema.ts
    ├─ LEDGER_COLUMN_COUNT (=7)
    ├─ LEDGER_KEY_COLUMNS (=[6] 事件ID)
    ├─ LEDGER_HEADER_ZH / EN
    ├─ LEDGER_INITIAL_ZH / EN
    └─ LEDGER_SCHEMA_INSTRUCTION_ZH / EN  # Prompt 模板含事件ID 规则

packages/core/src/utils/governed-working-set.ts
    ├─ mergeTableMarkdownByKey           # 通用按 key 合并，有 schema-mismatch guard
    ├─ mergeCharacterMatrixMarkdown      # ⚠️ 对扁平单表 no-op（P3-C）
    ├─ buildGovernedHookWorkingSet
    └─ buildGovernedCharacterMatrixWorkingSet

packages/core/src/utils/context-filter.ts  # 简单 filter 层
    ├─ filterHooks (去掉已回收)
    ├─ filterSummaries (保留最近 N 章)
    ├─ filterSubplots (去掉已关闭)
    ├─ filterEmotionalArcs (保留最近 N 章)
    └─ filterCharacterMatrix (按卷纲角色过滤)

packages/core/src/utils/hook-governance.ts
    ├─ collectStaleHookDebt              # 陈旧 hook 检测
    └─ classifyHookDisposition

packages/core/src/utils/hook-health.ts
    └─ (audit warning 生成)

packages/core/src/state/manager.ts
    ├─ restoreState (L269+)              # rework 和 CLI rewrite 用
    ├─ snapshotState (L235+)             # 每章写完后保存
    ├─ SNAPSHOTTABLE_STORY_FILES         # 快照覆盖哪些文件
    └─ REQUIRED_STORY_FILES               # 必需文件（current_state + hooks）

packages/cli/src/commands/write.ts
    └─ "rewrite" subcommand (L85+)       # CLI 层的 write rewrite 命令
                                          # 和 reviser rework 模式语义一致但代码路径独立
```

---

## 10. 与用户合作的风格偏好

**用户 = PapainTea**，主要维护者：

- **语言**：主要中文，技术术语可以混 English
- **偏好**：**产品和架构层面讨论**，**不爱看大段 code diff**
- **决策风格**：**先问清楚再动手**。不要一上来就大改，先给方案让他选
- **成本敏感**：关心 token 开销，但可以接受"更贵但更对"的方案
- **数据洁癖**：对真相文件一致性要求极高，**宁可 token 多也要保证一致**
- **可回滚要求高**：任何破坏性操作必须先备份（`.backup-<timestamp>`）
- **不是 TypeScript 专家**：代码细节讨论时要解释清楚，不要假设他看得懂

**禁忌（不要做的事）**：
- ❌ 不要擅自同步上游代码
- ❌ 不要在 spot-fix 模式里加"大修改"能力（那应该用 rework）
- ❌ 不要删除 `.backup-*` 文件（用户的回滚保险）
- ❌ 不要对快照做批量覆盖（严格快照时间语义）
- ❌ 不要在项目根目录跑 vitest
- ❌ 不要 force push / amend 已发布 commit
- ❌ 不要改 `chapter_summaries.md` 的 schema（用户不想加 merge 字段）
- ❌ 不要 import 或调用 inkOS 源码里的 TypeScript 合并函数**在数据恢复脚本里**（脚本要独立用 Python/node 实现，避免 runtime 耦合）

---

## 11. 常见 bug 模式和调试 tips

### 11.1 "真相文件数据丢失"

**症状**：用户发现某个真相文件里的行数突然减少，或者历史章节的内容不见了。

**排查步骤**：
1. 对比 `story/snapshots/N/<文件>.md` 和 `story/<文件>.md`，看哪个版本更完整
2. 如果快照版本完整但 current 丢失 → 是某个写入路径覆盖了
3. 查看 `story/snapshots/` 下各快照的行数趋势，找**突降点**（s(N-1) 比 sN 行数多）
4. 突降点附近的 pipeline 日志会指向哪个阶段出的问题

**可能原因**：
- `writer.saveChapter` 的 4 文件整体覆盖路径（P1-B 待修）
- `reviser` 的 partial patch 输出格式缺失（P1-A 待修）
- LLM 在写作时输出了不完整的真相文件（会被 settler prompt 错误约束影响）

### 11.2 "合并后出现重复行"

**症状**：合并后同一条记录出现 2+ 次，或者同一 hook_id 出现 2 条。

**可能原因**：
- 合并 key 选择错误（比如用了 `[0]` 但第 0 列不是 unique key）
- Schema-mismatch guard 触发：`mergeTableMarkdownByKey` 发现 header 不一致时直接 `return updated`，导致数据被覆盖
- 事件ID 不稳定（LLM 没复用原 ID，改用了新 ID）

### 11.3 "Schema 不兼容"

**症状**：`mergeTableMarkdownByKey` 返回 `updated`（整体覆盖）而不是真正合并。

**可能原因**：
- 两边 header 不完全一致（大小写/空格/列顺序）
- 一边是 6 列，另一边是 7 列，但没过 normalize
- 英文账本和中文账本 header 字段名不同

**修复**：走 `mergeLedgerTables` helper（自动 normalize 两边）而不是直接调 `mergeTableMarkdownByKey`。

### 11.4 "正文和真相文件不一致"

**症状**：正文里说某角色 X 出场了，但 character_matrix 里没有 X。

**可能原因**：
- spot-fix / polish / rewrite / anti-detect 模式改了正文但没动 4 个真相文件（这是语义层问题，P1-A 修复）
- settler / writer 的 prompt 对这些文件的格式要求不清晰
- LLM 输出被 merge 层过滤掉了（检查 settler 实际输出的 markdown 和 prompt 里的约束）

### 11.5 Pipeline Stage 查日志的地方

- `~/.inkos/data/books/<书名>/story/logs/<timestamp>.ndjson`：pipeline 运行事件日志
- `~/.inkos/data/books/<书名>/story/rebuild-cache/<N>/settler-output.md`：rebuild ledger 流程里每章 settler 的完整输出
- Studio 前端的 pipeline SSE 流：实时阶段推进

---

## 12. 最近一次 session 的关键产出（2026-04-11 ~ 2026-04-12）

**已完成**（全部已 commit）：
1. 账本 7 列 schema + 事件ID 列（代码 + prompt 全链路）
2. character_matrix 3 子表 prompt 在 settler/writer/analyzer 对齐
3. Bug 2（writer.ts scaffold 门禁）修复
4. Bug E 测试 `##` → `###` 修正
5. 打包 Mac DMG/PKG + Windows Setup.exe
6. **镜源逆刻 + 长夜的完整数据恢复**（PROMPT-2 执行）
7. **reviser rework mode 改为 restore + regenerate** — commit `14a5799` (2026-04-11)
8. 通用版 PROMPT-3 写完 — commit `0556827` (2026-04-11)
9. **P0 — reviser context filter 补齐** — commit `788afed` (2026-04-11)
   - import filterHooks / filterCharacterMatrix
   - 非 governed 路径的 hooks / character_matrix 走 filter
   - chapter_summaries filter 改为无条件调用
   - 收益：镜源逆刻 ch12 revise 场景约 5-8k input tokens/次
10. **P1-B — writer.ts saveChapter/saveNewTruthFiles 加 merge 兜底** — commit `9d97311` (2026-04-11)
    - 新增 `hasMarkdownTableDataRows` / `isEmptyTruthContent` / `mergeChapterSummariesMarkdown` 三个 helper
    - 新增 `writer.saveMergedTruthFile` 私有方法（read→merge→write，empty skip）
    - 5 个写入点改走 saveMergedTruthFile（chapter_summaries / subplot_board / emotional_arcs / character_matrix）
    - Bug E 第三层封堵
11. **P1-A — reviser sentinel-first 扩展到 7 文件** — commit `b43f2cd` (2026-04-11)
    - truth-file-persistence 新增 8 个 sentinel 常量 + 4 个 isXxxSentinel + isAnyTruthFileSentinel
    - isEmptyTruthContent 识别所有 sentinel
    - reviser 读 2 个新文件（subplot_board / emotional_arcs）+ 2 个新 context block
    - reviser outputFormat 加 4 个 UPDATED_* section，默认 sentinel，仅影响时输出新版
    - parser 提取 4 个新字段，ReviseOutput 接口扩展
    - runner.reviseDraft 持久化段加 4 个 sentinel check + merge write
    - Bug E 第二层扩展（reviser 层 partial-patch 的一致性问题）
12. **P3-C — character_matrix 扁平单表 fallback + reviser 4 文件 isEmpty 兜底** — commit `ed0e77c` (2026-04-11)
    - `mergeCharacterMatrixMarkdown` 按 section 数量分 4 种情况处理（flat/flat 合并、3sub preserve regression、flat→3sub upgrade）
    - runner.reviseDraft 3 个 sentinel check 升级到 isEmptyTruthContent（Bug E 严格超集）
    - 删掉 4 个无用的 `isXxxSentinel` helper（`isEmptyTruthContent` 通过 `isAnyTruthFileSentinel` 统一识别）
    - 新增 3 个测试，基线从 499 → 502
13. **Mac 打包 libnode shim 问题修复** — commit `51dab6d` (2026-04-11)
    - 发现 v0.2.2.5 / 旧 v0.2.2.6 的 `MacOS/node` 是 homebrew 的 33KB shim，依赖 `@rpath/libnode.141.dylib`
    - 装到没 homebrew 的机器必炸（用户机器就是因此装不了新版）
    - 改 `copy-dist-assets.cjs` 用 `/tmp/inkos-node-cache/` 下的官方 Node 18.20.4 自包含二进制
    - 代价：`MacOS/node` 从 33 KB 变 87 MB，DMG 从 46 MB → 80 MB
14. **Studio 刷新恢复 2 个 bug** — commit `0a502f6` (2026-04-12)
    - Bug 1：刷新后落到书架 dashboard，不自动进入 pipeline view。根因是 `initPipeline` 内部异步 `checkPipelineStatus()` 和 `initRouter()` 的 "/" handler 硬编码 setView("dashboard") 抢最后一个 setView，production 常常 dashboard 赢
    - 引入 commit：`d838702` (2026-03-30) feat: path router
    - 修复：`checkPipelineStatus` 从 initPipeline 移出，app.js boot 里 `initRouter()` 之后 await 调用（严格串行）
    - Bug 2：pipeline view 刷新后 stage 全空、content 进不来。根因是 `task.events` buffer 上限 2000 / trim 到 1500 的逻辑，长章节（15+ 分钟）把 stage-start 事件挤出 ring buffer，客户端 replay 没 active stage
    - 触发条件成熟于 `626b26a` (2026-04-01) / `49d9268` (2026-04-01) / `a310e18` (2026-04-03) 这几个"加 stage / 加流式阶段" feature commits
    - 修复：服务端 `recordPipelineEvent` 记录 `task.currentStage` 字符串字段；客户端 replay 后 fallback activate
15. **CLAUDE.md §8 Git 约定新增日期规则** — commit `0a502f6` (2026-04-12)
    - 要求：`<hash> (YYYY-MM-DD) <subject>`
    - 目的：bug 引入时间一眼可见

**Bug E 三层修复全部完成**：
- 第一层 runner.buildPersistenceOutput ✅ `b75ddc9` (2026-04-11)
- 第二层 runner.reviseDraft state/ledger/hooks 持久化 ✅ `b75ddc9` + `56d8421` (2026-04-11)
- 第二层扩展 runner.reviseDraft 4 个新真相文件持久化 ✅ `b43f2cd` (2026-04-11)，后又在 `ed0e77c` (2026-04-11) 升级到 isEmpty 严格超集
- 第三层 writer.saveChapter / saveNewTruthFiles merge 兜底 ✅ `9d97311` (2026-04-11)

**最近 10 个 commit 历史**（带日期）：
```
0a502f6  (2026-04-12)  ‼️ fix: Studio 刷新恢复 — routing race + stage 活跃状态丢失
51dab6d  (2026-04-11)  ‼️ fix: Mac 打包改用官方 Node 18 避免 libnode.141.dylib
ed0e77c  (2026-04-11)  ‼️ fix: character_matrix 扁平单表 fallback + reviser 4 文件 isEmpty 兜底（P3-C）
b5165f8  (2026-04-11)  docs: CLAUDE.md 标记 P0/P1-A/P1-B 完成并移到 §12
b43f2cd  (2026-04-11)  ‼️ fix: reviser sentinel-first 扩展到 7 文件（P1-A Bug E 完整补完）
9d97311  (2026-04-11)  ‼️ fix: writer.ts saveChapter/saveNewTruthFiles 加 merge 兜底（Bug E 第三层）
788afed  (2026-04-11)  ‼️ fix: reviser context filter 补齐（P0 免费午餐）
f723987  (2026-04-11)  docs: CLAUDE.md 大幅细化（367 → 681 行）
14a5799  (2026-04-11)  ‼️ fix: reviser rework 模式走快照恢复 + 重新生成
56d8421  (2026-04-11)  ‼️ fix: v0.2.2.6 补完 — 账本 schema 升级为 7 列
```

**剩余 TODO**（§6 详情）：
- **🔴 P-HOT**：settler/observer LLM 卡死 97 分钟（2026-04-12 发现，详见 §6）
- **P2**：伏笔陈旧度 prompt 强化（30 分钟，触碰 settler prompt 有 production 风险）
- **P3-A**：滚动章纲 / 滑动窗口（半天以上，feature 级）
- **P3-B**：缺失的 3 个 rebuild 工具（每个 2-3 小时）

---

## 13. 本地交接文件（不入 git，但对下一个 session 重要）

`output/` 目录下有详细的 session 交接材料（因 `.gitignore` 不入 git，但新 session 能读）：

- `output/SESSION-FOLLOWUP-2026-04-11.md` —— 完整 session 交接报告（含用户原话、数据恢复验证表、所有细节）
- `output/PROMPT-CODEX-CONTINUE-LEDGER-MIGRATION.md` —— 给用户的 Codex 续跑 prompt（账本 6→7 迁移）

仓库根目录下的文档（已入 git）：
- `BUG-FIX-PLAN-ALL.md` —— v0.2.2.6 bug 规划
- `BUG-REPORT-LLM-STREAM-FALLBACK.md` —— LLM 流式 fallback 调研
- `PROMPT-1-CODE-FIX.md` —— PROMPT-1 执行指令
- `PROMPT-2-DATA-RECOVERY.md` —— 镜源逆刻/长夜专用恢复 prompt
- `PROMPT-3-DATA-RECOVERY-GENERIC.md` —— 通用版数据恢复 prompt

---

## 14. 快速启动清单（新 session agent 用）

1. 读本文件 `CLAUDE.md`（Claude Code 会自动加载）
2. 读 `output/SESSION-FOLLOWUP-2026-04-11.md`（如果还在本地）
3. 跑 `git status` 看工作树状态
4. 跑 `git log --oneline -5` 看最近 commit
5. 如果是继续上 session 的工作，直接看 §6 待办清单，按优先级推进
6. 跟用户确认当前要做什么再动手（不要擅自推进）

---

**结语**：本文件是"活的"项目记忆，应该随着架构演进持续更新。每次做重大改动后，把新发现 / 新约束 / 新 bug 模式补进相应章节。如果某条 TODO 完成了，从 §6 移到 §12。
