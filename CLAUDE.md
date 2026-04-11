# inkOS —— 项目上下文（给 Claude Code 的常驻记忆）

> 本文件是 fork `PapainTea/inkos` 的专用项目指引。上游是 `Narcooo/inkos`，本 fork 已经**显著发散**（schema / prompt / 合并逻辑都有差异），**不要尝试同步上游**。

---

## 项目一句话概述

**inkOS 是一个多 agent AI 网络小说写作流水线**。用户（作者）通过 CLI 或 Studio（本地 web UI）指挥一组 LLM agent 逐章创作长篇小说，同时维护一套严格的世界状态（真相文件）。

**目标读者**：严肃长篇中文网文作者。用户 `PapainTea` 是主要维护者，正在用这个工具写 2 本书：**镜源逆刻**（12 章）和 **长夜**（1 章）。

**核心价值主张**：
1. 多 agent 协作保证写作质量（不是单次 LLM 调用）
2. 真相文件（ledger / hooks / subplots / emotional arcs / character matrix / chapter summaries）保证长篇一致性
3. 快照系统支持回滚、修订、数据恢复

---

## 架构速览

### 1. Monorepo 结构

```
packages/
├── core/          # LLM pipeline 核心，所有 agent 代码
├── cli/           # inkos CLI (inkos write, inkos revise, etc.)
└── studio/        # 本地 GUI (server.cjs + public/ 前端)
```

### 2. 核心 Agent（按 pipeline 顺序）

`packages/core/src/agents/` 下的 agent：

| Agent | 作用 |
|---|---|
| **architect** | 初始化新书：生成 story_bible / volume_outline / book_rules 等 |
| **planner** | 规划当前章节的章意图（chapter intent）|
| **composer** | 合成 context package + rule stack（governed mode）|
| **writer** | 撰写章节草稿，同时产出 runtime state delta |
| **length-normalizer** | 字数归一化（目标区间微调）|
| **continuity**（auditor）| 审稿：OOC / 信息越界 / 设定冲突 / 节奏 / 词汇疲劳 / 战力崩坏 |
| **reviser** | 修订章节，5 种模式：spot-fix / polish / rewrite / rework / anti-detect |
| **chapter-analyzer** | 分析已写章节，提取状态变化（用于重建流程）|
| **settler** | 结算本章状态变化，输出所有真相文件的更新 |
| **titler** | 生成章节标题 |
| **post-write-validator** | 写后校验（敏感词、AI 痕迹等）|
| **detector** / **radar** | AI 生成痕迹检测 |

### 3. Pipeline 入口（在 `packages/core/src/pipeline/runner.ts`）

| 方法 | 作用 |
|---|---|
| `writeNextChapter` | 写下一章（主力入口）|
| `reviseDraft` | 修订某章（5 种模式）|
| `spotfixChapter` | 高层 spot-fix 封装 |
| `rebuildLedgerFromChapters` | 从所有章节正文重建资源账本 |
| `rebuildHooksFromChapters` | 从所有章节正文重建伏笔池 |

### 4. 真相文件（Truth Files）—— 核心概念

每本书的 `story/` 目录下有 **7 个真相文件**，是世界状态的持久化层：

| 文件 | schema | 用途 | 合并语义 |
|---|---|---|---|
| **particle_ledger.md** | **7 列**（章节/资源名称/期初/变动/期末/事由/**事件ID**）| 资源账本 | 按 `事件ID` 合并（v0.2.2.6+ 新增）|
| **emotional_arcs.md** | 6 列（角色/章节/情绪状态/触发/强度/弧线方向）| 情感弧线 | 按 `[角色, 章节]` 合并 |
| **pending_hooks.md** | 7 列（hook_id/起始/类型/状态/推进/预期/备注）| 伏笔池 | 按 `[hook_id]` 合并 |
| **subplot_board.md** | 9 列（支线ID/支线名/相关角色/起始/活跃/距今/状态/进度/ETA）| 支线进度板 | 按 `[支线ID]` 合并 |
| **character_matrix.md** | **3 子表**（`### 角色档案` + `### 相遇记录` + `### 信息边界`）| 角色交互矩阵 | 按 section 分别合并，各自 key |
| **chapter_summaries.md** | 8 列（章节/标题/出场/关键事件/状态变化/伏笔动态/情绪基调/类型）| 章节摘要 | 按 `[章节]` append（**未做 merge 兜底，是 v0.2.2.6 盲点**）|
| **current_state.md** | 字段表（章节/位置/主角状态/目标/限制/敌我/冲突）| 当前状态卡 | 每章整体覆盖 |

### 5. 快照系统

每写完一章 N，`story/snapshots/N/` 会保留当时所有真相文件的完整副本。支持：
- `restoreState(N)` —— 恢复所有真相文件到第 N 章的状态
- rework 模式 = `restoreState(N-1)` + 重新 `writeNextChapter`
- 数据恢复脚本（PROMPT-2 / PROMPT-3）通过快照递增恢复历史数据

---

## 关键约束和行为规则

### 1. Reviser 的 5 种模式差异（语义层，不要混淆）

| 模式 | 中文名 | 改动幅度 | 真相文件写入 |
|---|---|---|---|
| `spot-fix` | 定点修复/针对性修订 | 单句或段落 | 只写 state/ledger/hooks 3 个 |
| `polish` | 润色 | 表达/节奏 | 同上 |
| `rewrite` | 改写 | 段落级重组 | 同上 |
| `anti-detect` | 反检测 | AI 痕迹清洗 | 同上 |
| **`rework`** | **重写** | **整章重生成** | **恢复到 snapshot(N-1) + 重跑 writeNextChapter**，所有 7 个文件都会被正确更新 |

**重点**：只有 `rework` 走 restore + regenerate 路径（2026-04-11 新增）。其他 4 个模式都是 partial-patch。**不要擅自把其他模式也改成 restore + regenerate**，那会破坏 spot-fix 的"surgical"语义。

### 2. `particle_ledger.md` 的 7 列 schema（v0.2.2.6 新增）

第 7 列 `事件ID` 是合并 key。LLM 的行为规则：
- **修正已有事件**：必须复用该行原来的 `事件ID`
- **新增事件**：生成 `ch{章节}-{资源名}-{序号}` 格式的新 ID
- LLM 忘填时，`normalizeLedgerMarkdown` 自动用内容哈希生成 `auto-ch{章节}-{hash6}` 兜底

**旧书（6 列无事件ID）自动自愈**：`saveChapter` / `rebuildLedger` / `mergeLedgerTables` 写入前都会过 normalize，6 列数据自动升级到 7 列。用户无感。

### 3. `character_matrix.md` 必须是 3 子表结构

```markdown
# 角色交互矩阵

### 角色档案
| 角色 | 核心标签 | ... | 当前目标 |
...

### 相遇记录
| 角色A | 角色B | 首次相遇章 | 最近交互章 | 关系性质 | 关系变化 |
...

### 信息边界
| 角色 | 已知信息 | 未知信息 | 信息来源章 |
...
```

3 个 `### ` 小标题是硬性要求。`mergeCharacterMatrixMarkdown` 函数依赖它们识别 section。

**如果遇到扁平单表格式的 character_matrix**：
- 不要直接用上游的 `mergeCharacterMatrixMarkdown`（对扁平是 no-op）
- 需要用 LLM 重建成 3 子表（见 PROMPT-2 / PROMPT-3 的算法 3）
- 或者作为 fallback 用 `mergeTableMarkdownByKey(a, b, [0])` 按角色单列 key 合并

### 4. Bug E 合并兜底（v0.2.2.6 的核心修复）

`runner.ts:buildPersistenceOutput`（分析器路径）对 5 个文件都加了 merge 兜底：
- ledger → `mergeLedgerForPersistence`
- hooks → `mergeTableMarkdownByKey(..., [0])`
- subplots → `mergeTableMarkdownByKey(..., [0])`
- emotional_arcs → `mergeTableMarkdownByKey(..., [0, 1])`
- character_matrix → `mergeCharacterMatrixMarkdown`

**⚠️ 盲点**：`writer.ts:saveChapter` 和 `saveChapterFromWriterOutput` 的写入路径**还没加 merge 兜底**（直接整体覆盖）。这是 v0.2.2.6 时当时遗漏的。2026-04-11 发现并记录在 `output/SESSION-FOLLOWUP-2026-04-11.md` 第 4.2 节，待修复。

### 5. `chapter_summaries.md` 的合并问题

**已知 bug**：`saveChapter` 整体覆盖 chapter_summaries，没有 merge 兜底。如果 LLM 输出压扁（header 和 data 挤到一行），历史章节会丢。

**临时解决**：2026-04-11 的 session 已经手工恢复了镜源逆刻的 chapter_summaries（ch1-12 完整）。但代码层的根因还没修。

### 6. 修订流程写入的文件（spot-fix / polish / rewrite / anti-detect）

在 `runner.ts:reviseDraft` 的 L1047-1068：
```
写 current_state.md     （覆盖）
写 particle_ledger.md   （经 mergeLedgerForPersistence 合并）
写 pending_hooks.md     （经 mergeTableMarkdownByKey 合并）
```

**不写**：subplots / emotional_arcs / character_matrix / chapter_summaries。

如果用户担心 spot-fix 影响这 4 个文件的一致性，建议用 rework 模式（会触发全流程重跑）。

---

## 测试和构建约定

### 测试命令

```bash
# Core 包测试（含所有 agent 和 pipeline 测试）
cd packages/core && npx vitest run

# 类型检查
cd packages/core && npx tsc --noEmit
```

**硬性要求**：任何 commit 前必须 `vitest run` 全绿（目前 499/499）。

**⚠️ 重要**：**不要在项目根目录跑 vitest**，根目录会扫到 `packages/studio/dist/` 下的 studio UI 测试，那些在 dist 被 rebuild 时会报 module not found。**必须 cd 到 `packages/core/`**。

### 构建命令

```bash
# Mac 打包
cd packages/studio && npx pkg server.cjs --targets node18-macos-x64 --output dist/inkos-studio-mac
cd packages/studio && node scripts/copy-dist-assets.cjs --mac
cd packages/studio && bash scripts/build-mac-installer.sh

# Windows 打包
cd packages/studio && npx pkg server.cjs --targets node18-win-x64 --output dist/inkos-studio.exe
cd packages/studio && makensis installer.nsi
```

产物在 `packages/studio/dist/`：
- `InkOS-Studio-0.2.2.6-mac.dmg`
- `InkOS-Studio-Setup-0.2.2.6-mac.pkg`
- `InkOS-Studio-Setup-0.2.2.6.exe`

---

## Commit 约定

- **Bug 修复**：用 `‼️` 前缀（比如 `‼️ fix: v0.2.2.6 补完 — 账本 schema 升级为 7 列`）
- **Feature**：用 `feat: ...`
- **文档**：用 `docs: ...`
- **Chore**：用 `chore: ...`
- Message 末尾加 `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
- **不要 amend 已发布的 commit**，创建新 commit
- **不要 push origin**（那是上游 Narcooo，无写权限）；push 到 `papaintea` remote
- **不要 force push**

---

## 核心目录和文件速查

```
项目根目录：
/Users/admin/Codex/Project/inkOS/

核心代码（按重要性）：
packages/core/src/pipeline/runner.ts         # 主 pipeline，reviseDraft 等
packages/core/src/agents/writer.ts           # writer + saveChapter 持久化
packages/core/src/agents/reviser.ts          # 修订 agent
packages/core/src/agents/settler-prompts.ts  # settler prompt
packages/core/src/agents/chapter-analyzer.ts # 分析器
packages/core/src/agents/writer-prompts.ts   # writer prompt
packages/core/src/utils/truth-file-persistence.ts  # merge helpers
packages/core/src/utils/ledger-schema.ts     # 账本 7 列 schema 常量
packages/core/src/utils/context-filter.ts    # 5 个 filter 函数
packages/core/src/utils/hook-governance.ts   # 陈旧 hook 检测
packages/core/src/state/manager.ts           # 快照 / restoreState

用户数据（不进 git，在家目录）：
~/.inkos/data/books/<书名>/
    story/
        particle_ledger.md
        emotional_arcs.md
        pending_hooks.md
        subplot_board.md
        character_matrix.md
        chapter_summaries.md
        current_state.md
        snapshots/<N>/  # 每章的完整快照
    chapters/
        0001_xxx.md
        0002_xxx.md
        ...
        index.json

Session 产出文档：
output/SESSION-FOLLOWUP-2026-04-11.md           # 前一个 session 的完整交接报告
output/PROMPT-CODEX-CONTINUE-LEDGER-MIGRATION.md # Codex 续跑 prompt
PROMPT-2-DATA-RECOVERY.md                        # 镜源逆刻/长夜专用恢复 prompt
PROMPT-3-DATA-RECOVERY-GENERIC.md                # 通用恢复 prompt（给端用户）
BUG-FIX-PLAN-ALL.md                              # v0.2.2.6 bug 规划
```

---

## 与用户合作的风格偏好

**用户 = PapainTea**，主要维护者：

- **语言**：主要中文，技术术语可以混 English
- **偏好**：产品和架构层面讨论，**不爱看大段 code diff**
- **决策风格**：**先问清楚再动手**。不要一上来就大改，先给方案让他选
- **成本敏感**：关心 token 开销，但可以接受"更贵但更对"的方案
- **数据洁癖**：对真相文件一致性要求极高，**宁可 token 多也要保证一致**
- **可回滚要求高**：任何破坏性操作必须先备份（`.backup-<timestamp>`）

**禁忌**：
- ❌ 不要擅自同步上游代码
- ❌ 不要在 spot-fix 模式里加"大修改"能力
- ❌ 不要删除 `.backup-*` 文件
- ❌ 不要对快照做批量覆盖（严格快照时间语义）
- ❌ 不要用项目根目录跑 vitest
- ❌ 不要 force push / amend 已发布 commit

---

## 最近一次 session 的关键产出（2026-04-11）

**已完成**（全部已 commit 并 push papaintea）：
1. 账本 7 列 schema + 事件ID 列（代码 + prompt 全链路）
2. character_matrix 3 子表 prompt 在 settler/writer/analyzer 对齐
3. Bug 2（writer.ts scaffold 门禁）修复
4. Bug E 测试 `##` → `###` 修正
5. 打包 Mac DMG/PKG + Windows Setup.exe
6. **镜源逆刻 + 长夜的完整数据恢复**（PROMPT-2 执行）
7. **reviser rework mode 改为 restore + regenerate**（对齐 CLI `write rewrite`，commit `14a5799`）
8. 通用版 PROMPT-3 写完（commit `0556827`）

---

## 待办清单（下一个 session 请按优先级推进）

### 🟢 P0 —— 10 分钟免费午餐（立刻做，零风险）

**`reviser.ts` context 瘦身**
- **问题**：`reviser.ts:10` 只 import 了 `filterSummaries`，没用另 4 个已有的 filter 函数
- **影响**：reviser 发给 LLM 的 context 里，pending_hooks / subplot_board / emotional_arcs / character_matrix 全量发送（含已回收/已关闭/远期历史）
- **修复**：import `filterHooks / filterSubplots / filterEmotionalArcs / filterCharacterMatrix` 并在 reviser.ts L124-143 governed mode 分支里调用
- **收益**：每次 revise 省约 14k input tokens（镜源逆刻 ch12 场景）约 30% 成本
- **风险**：零（这些 filter 函数在 writer.ts / continuity.ts 里已经是正常行为）
- **工作量**：约 10 分钟（改 1 个文件 + 跑测试验证）

### 🟡 P1 —— Bug E 完整补完（Session 讨论过但未实施）

**A. Sentinel 机制扩展 reviser 输出**
- **问题**：Reviser 的 outputFormat 只输出 3 个文件（state/ledger/hooks），不输出另 4 个真相文件。如果 spot-fix 的修订意外影响了角色矩阵/情感弧线/支线/章节摘要，这 4 个文件不会被同步
- **修复方案**（用户最终拍板是 sentinel-first）：
  1. reviser.ts 的 outputFormat 加 4 个新 section：UPDATED_SUBPLOTS / UPDATED_EMOTIONAL_ARCS / UPDATED_CHARACTER_MATRIX / UPDATED_CHAPTER_SUMMARIES
  2. 默认要求 LLM 输出 sentinel（`(支线板未更新)` / `(情感弧线未更新)` 等），**只有真的影响了才输出完整新版**
  3. reviser-parser 支持识别这 4 个新字段 + sentinel
  4. runner.ts reviseDraft 持久化段：检测到 sentinel → **完全不调 writeFile**（连 merge 都不走），保留原文件
- **Token 成本**：常见 case +40 tokens（4 个 sentinel），少见 case 才 +8-15k
- **解决的问题**：spot-fix 改变正文后 4 个真相文件的潜在不一致
- **工作量**：约 1-1.5 小时

**B. writer.ts saveChapter merge 兜底**
- **问题**：PROMPT-1 Bug E 修复只覆盖了 runner.ts 的 analyzer 路径，**writer.ts 的 saveChapter 和 saveChapterFromWriterOutput 直接整体覆盖 4 个文件**（L898-902 和 L1227-1232）没有兜底
- **这是为什么**：镜源逆刻 chapter_summaries 会丢 ch5/7/9/11 → 不是 reviser 改的，是 writer 的 saveChapter 在新建章节时覆盖的
- **修复**：给这 4 个文件的 writer.ts 写入点各加 merge 兜底（类似 `mergeLedgerTables` 模式）
- **需要新 helper**：`mergeChapterSummariesMarkdown`（按 `[章节]` = 第 0 列合并）；另 3 个复用现有的 `mergeTableMarkdownByKey`
- **工作量**：约 1 小时

**这两项 A 和 B 语义相关（都是让 writer 和 reviser 的 4 文件更新路径有安全兜底），建议一起做。**

### 🟡 P2 —— 伏笔治理（镜源逆刻 49/2 resolved 太低）

**伏笔陈旧度 prompt 强化**
- **问题**：镜源逆刻 pending_hooks.md 里 49 个 hook 只有 2 个 resolved（4%），偏低
- **现状**：`hook-governance.ts` 已经有 `collectStaleHookDebt` 检测陈旧 hook（长期未推进），`hook-health.ts` 会产出 warning，但都是 audit warning，LLM 看不到或不重视
- **修复（温和方案）**：
  1. 在 settler user prompt 里显式塞入 stale hook 列表："以下 hook 已经 X 章未推进"
  2. 加鼓励语："本章优先处理其中至少 1 个陈旧 hook（推进 / 延后 / 回收三选一）"
  3. **不加硬约束**（避免 LLM 为了完成指标乱 resolve 重要伏笔）
- **工作量**：约 30 分钟

### 🔵 P3 —— Feature 级（v0.2.3.x 级别，本 session 讨论过但需要独立周期）

**滚动章纲 / 滑动窗口章纲**
- **用户想法**：写 ch N 时，context 里应该有"本章 + 前 3 章历史摘要 + 后 3 章规划"
- **现状**：
  - **前 3 章历史**：`filterSummaries(keepRecent=5)` 已有，默认 5 可以改 3
  - **后 3 章规划**：**没有**，需要从 `volume_outline.md` 切片或新建文件
- **建议方案**：新增 `chapter_window_outline.md` 文件，每次写完一章滚动更新
- **不适合塞进 bug fix session**，需要独立 feature 周期
- **工作量**：半天以上（设计 + 实现 + UI 集成）

**Character_matrix / subplot_board / emotional_arcs rebuild 功能**
- **现状**：只有 `rebuildHooksFromChapters` 和 `rebuildLedgerFromChapters`，另 3 个文件没有 rebuild 工具
- **何时需要**：未来出现数据损坏或 schema 漂移时
- **工作量**：每个约 2-3 小时

**Character_matrix 扁平单表 fallback**
- **问题**：`mergeCharacterMatrixMarkdown` 对扁平单表（无 ### section）是 no-op
- **现状**：当前数据已经全部 3 子表化，问题被数据修复暂时压制
- **长期修复**：在 `runner.ts:2305` 的调用外包一个 wrapper，检测 0 sections 就 fallback 到 `mergeTableMarkdownByKey(..., [0])`
- **工作量**：约 30 分钟

---

## 本地 session 交接文件（不入 git）

`output/` 目录下有本 session 的完整交接报告（因 `.gitignore` 不入 git，但新 session 能读）：

- `output/SESSION-FOLLOWUP-2026-04-11.md` —— 完整 session 交接报告（含用户原话、数据恢复验证表、所有细节）
- `output/PROMPT-CODEX-CONTINUE-LEDGER-MIGRATION.md` —— 给用户的 Codex 续跑 prompt（账本 6→7 迁移）

---

## 快速启动检查清单（给新 session 的 agent 用）

1. 读本文件 `CLAUDE.md`
2. 读 `output/SESSION-FOLLOWUP-2026-04-11.md`（或最新的 session follow-up）
3. 跑 `git status` 看工作树状态
4. 跑 `git log --oneline -5` 看最近 commit
5. 确认用户的当前目标再动手
