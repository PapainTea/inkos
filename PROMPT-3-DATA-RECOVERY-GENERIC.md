# Prompt 3：inkOS 数据恢复（通用版 v1）

> **使用说明**：把下面分隔线以下的全部内容复制到 **Claude Code** 或 **Codex CLI** 或其他具有本地文件系统写入权限的 AI 代理。
>
> **环境要求**：
> - 对 `~/.inkos/data/` 有写权限
> - 能调用 LLM API（character_matrix 重建需要）
> - 预计每本书 LLM 调用次数 = 章节数 × 1（镜源逆刻 12 章就是 12 次 LLM 调用）
>
> **适用场景**：你（inkOS 用户）发现历史章节的某些真相文件（资源账本/伏笔池/支线/情感弧线/角色矩阵）有数据丢失或格式错乱，想批量恢复/修复它们。

---

# ⚠️ CRITICAL CONSTRAINTS — READ AND OBEY BEFORE DOING ANYTHING

This prompt makes potentially destructive writes to `~/.inkos/data/`. Disobeying any of the following 20 constraints will result in data loss or incorrect state. **You MUST read this entire section before starting step 0.**

## 总则

1. **一次只处理一本书**。严禁并发处理多本书。
2. **每本书处理前必须停下等用户回复** "YES" / "NO" / "SKIP" / "STOP"。**严禁自动继续**。
3. **每本书处理完后必须停下输出报告**，然后再次停下等用户回复是否继续下一本。
4. **所有写入前必须先备份**。`.backup-<timestamp>` 后缀，不得覆盖。
5. 处理过程中任何**异常、格式错误、schema 不一致**都必须**立刻停下报告**，不得尝试"修复"未知情况。
6. **绝不**在任何时候直接扫所有书就开跑 —— 即使用户说"全部处理"，也必须按顺序一本一本走，每本停下等确认。

## 关于 schema 和 merge 语义

7. **资源账本（particle_ledger.md）使用 7 列 schema**：`章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID`。旧版本的书可能只有前 6 列，本 prompt 会自动迁移到 7 列。
8. **角色交互矩阵（character_matrix.md）必须是 3 子表结构**：`### 角色档案`、`### 相遇记录`、`### 信息边界`。扁平单表是旧版本的格式，必须用 LLM 按章节正文重建。
9. **伏笔池（pending_hooks.md）按 hook_id 合并**，同 id 后覆盖前；**支线进度板（subplot_board.md）按 支线ID 合并**，同 id 后覆盖前；**情感弧线（emotional_arcs.md）按 [角色, 章节] 双列 key 合并**。
10. **章节摘要（chapter_summaries.md）和 当前状态卡（current_state.md）本 prompt 不处理**，前者是纯追加不会丢失，后者每次都整体覆盖不累积。

## 关于快照

11. **快照 `snapshots/N/` 的语义是"写完第 N 章后当时的累积状态"**，不是"最终结果的副本"。
12. **绝不**向 `snapshots/N/` 写入 N 章之后才出现的数据。
13. **绝不**用一个最终结果批量覆盖所有快照。
14. **绝不**修改 `snapshots/N/current_state.md`（即使它"看起来"不对，那是当时的真实状态）。

## 关于你（代理 / AI agent）的行为

15. **严禁** import 或调用 inkOS 源码里的 TypeScript 合并函数（避免 runtime 耦合）—— 用 Python/node/bash 独立实现算法。
16. **严禁**对 character_matrix.md 使用机械的按 key 合并（算法 1）—— 它必须走 LLM 重建（算法 3）。
17. **严禁**对 particle_ledger.md 用 content hash 去重作为主路径 —— 它必须先迁移到 7 列 schema，然后按 事件ID merge。
18. **严禁**跳过权限预检查（步骤 0）或者尝试"替代路径"（/tmp、项目目录等）。权限失败就直接停下报告。
19. **严禁**跳过备份步骤。
20. **你可能是 Codex / Claude Code / GPT 其他 agent**：无论你是谁，这个 prompt 对你的要求是**严格线性执行 + 每个 checkpoint 停下等回复**。不要以"我可以推理出用户想要什么"为由跳步。

---

# 执行步骤

## 步骤 0：权限预检查（必做）

在任何其他操作之前，测试对 `~/.inkos/data/` 的写权限：

```bash
touch ~/.inkos/data/.write-test && rm ~/.inkos/data/.write-test
```

**如果这一步失败**（比如权限不足、目录不存在、沙箱限制），立刻停止并报告：

```
=== ERROR: NO WRITE PERMISSION ===
路径：~/.inkos/data/
错误原因：<实际错误信息>

可能原因：
1. 你正在一个沙箱环境中运行（例如某些 Codex 云端环境），该环境不允许访问本地文件系统
2. 目录不存在（可能 inkOS 还未在本机运行过）
3. 权限被系统策略限制

解决方法：
- 换一个有本地文件系统访问的代理（Claude Code、本地 Codex CLI）
- 或在一个有写权限的本地 shell 里手动执行这个 prompt 描述的步骤

【停止执行，等待用户决定】
```

**不要尝试替代路径**（/tmp、项目目录下的副本等），直接报告停止。

## 步骤 1：扫描所有书并报告

**1.1** 列出 `~/.inkos/data/books/` 下的所有子目录：

```bash
ls -1 ~/.inkos/data/books/ 2>/dev/null
```

**1.2** 对每个子目录，判断它是不是一本真实的书（不是 `.zip` 文件、不是空目录、含 `story/` 子目录）：

```bash
for book in ~/.inkos/data/books/*/; do
  if [ -d "$book/story" ]; then
    echo "VALID: $book"
  fi
done
```

**1.3** 对每本有效的书，收集基本信息：
- 书名（目录名）
- 绝对路径
- `story/snapshots/` 下的最大章节号（如果 snapshots 目录不存在，标记为 "无快照"）
- 缺失的快照编号列表
- 要处理的 5 个文件是否存在（particle_ledger / emotional_arcs / pending_hooks / subplot_board / character_matrix）

**1.4** 输出完整的书列表报告：

```
=== SCAN COMPLETE ===
在 ~/.inkos/data/books/ 下发现 N 本有效的书：

[1] 书名A
    路径：/Users/.../books/书名A/
    最大章节：12
    缺失快照：无
    5 个真相文件：✅ 全部存在

[2] 书名B
    路径：/Users/.../books/书名B/
    最大章节：2
    缺失快照：[1] (ch1 的 snapshot 缺失)
    5 个真相文件：✅ 4 个存在，character_matrix.md 缺失

[3] 书名C
    路径：/Users/.../books/书名C/
    最大章节：无快照
    状态：⚠️ snapshots/ 目录不存在，将使用当前文件作为唯一数据源

...
```

**1.5** 输出完毕后，**停下等用户回复**：

```
=== 等待用户决定 ===

请回复以下选项之一：

  ALL   = 按顺序处理所有书，每本之间停下让我确认
  N     = 只处理第 N 本书（例如 "2" 只处理书名B）
  N,M   = 处理第 N 本和第 M 本（例如 "1,3"）
  SKIP  = 跳过所有书，本次不恢复
  STOP  = 中止流程

【不要自动继续。等待用户文字回复。】
```

**必须停下等回复**。不要猜测用户想要什么。

## 步骤 2：对选定的每一本书执行恢复（按列表顺序，一本一本来）

**对每一本要处理的书**，依次执行步骤 2.1 → 2.5。**每一本书完成后必须停下等用户确认是否继续下一本**。

### 2.1 本书处理前确认（针对该本书单独停一次）

输出这本书的处理计划：

```
=== 即将处理：<书名> ===
路径：/Users/.../books/<书名>/
最大章节：N
5 个真相文件：<列出状态>

处理计划：
  1. 整体备份 story/snapshots/ 目录
  2. 处理 particle_ledger.md（算法 2：6→7 列迁移 + 按 事件ID 合并）
  3. 处理 emotional_arcs.md（算法 1：[角色, 章节] key 合并）
  4. 处理 pending_hooks.md（算法 1：[hook_id] key 合并）
  5. 处理 subplot_board.md（算法 1：[支线ID] key 合并）
  6. 处理 character_matrix.md（算法 3：LLM 按章节正文重建 3 子表）
  7. 输出报告

预计 LLM 调用次数：N 次（character_matrix 每章 1 次）

请回复：
  YES  = 开始处理这本书
  SKIP = 跳过这本书，继续下一本
  STOP = 中止整个流程，不处理任何剩余的书

【等待你的回复。不要自动继续。】
```

**必须停下等回复**。收到 YES 才进入 2.2，SKIP 就跳到下一本书的 2.1，STOP 就进入步骤 3（总结收尾）。

### 2.2 阶段 A：本书整体备份（只做一次）

```bash
cp -r /Users/.../books/<书名>/story/snapshots \
      /Users/.../books/<书名>/story/snapshots.backup-$(date +%Y%m%d%H%M%S)
```

如果 `snapshots/` 目录不存在：记录 "无快照目录，跳过整体备份；后续仅处理当前文件"，**不算失败**，继续。

记录本书基本信息：
- 书名
- `snapshots/` 下的最大章节号 `max_N`（如果无快照则为 0）
- 要处理的 5 个文件列表
- 缺失的快照编号列表

### 2.3 阶段 B：对 5 个真相文件依次执行恢复

**严格按以下顺序**处理：

1. **particle_ledger.md** —— 先迁移到 7 列，再合并（算法 2 + 算法 1）
2. **emotional_arcs.md** —— 算法 1，`key_cols=[0,1]`、`chapter_col=1`
3. **pending_hooks.md** —— 算法 1，`key_cols=[0]`、`chapter_col=None`
4. **subplot_board.md** —— 算法 1，`key_cols=[0]`、`chapter_col=None`
5. **character_matrix.md** —— 算法 3，LLM 重建

每个文件的处理流程：

#### 步骤 B.1：备份当前文件（条件化）

```
如果 当前文件存在:
    cp /Users/.../books/<书名>/story/<文件名> \
       /Users/.../books/<书名>/story/<文件名>.backup-$(date +%Y%m%d%H%M%S)
    记录："已备份当前文件"
如果 当前文件不存在:
    记录："当前文件缺失，跳过单文件备份"
    不视为失败，继续后续步骤
```

**不要**对不存在的文件执行 `cp`，那会直接报错。
**不要**重复整体备份 `snapshots/` —— 那件事在阶段 A 做过一次就够了。

#### 步骤 B.2：分析丢失情况（容错）

对每个快照目录 N（按数字升序），统计行数：

```
对每个快照目录 N（按数字升序）：
  如果 snapshots/N/<文件名> 存在：记录行数
  如果 不存在：记录"无该快照文件"，不算失败

对当前文件：
  如果 存在：记录行数
  如果 不存在：记录"当前文件缺失"
```

识别**突降点**（行数突然远小于前一个快照）—— 这是典型的 bug 覆写痕迹。

#### 步骤 B.3：执行恢复

严格按对应算法执行（算法定义见下方"算法"章节）。

#### 步骤 B.4：验证

- 重新统计快照行数趋势，确认单调递增或至少不倒退
- 对 particle_ledger：
  - 验证每个 snapshot N 里 `row[0]`（章节列） > N 的行数为 0
  - 验证 `事件ID` 列所有值都非空且符合格式（`ch{章节}-{资源}-{序号}` 或 `init-0` 或 `auto-ch{章节}-{hash}`）
  - 抽查 5-10 个 事件ID 确认相同事件在快照间保持相同 ID
- 对 emotional_arcs：验证每个快照 N 里 `row[1]`（章节列） > N 的行数为 0
- 对 pending_hooks / subplot_board：验证所有 id 都在当前文件中
- 对 character_matrix：
  - 验证每个快照包含 3 个 `### ` 子表
  - 验证没有引用 N 章之后才出现的章节号
  - 抽查：snapshot N 的 `角色档案` 里的角色是否都在 ch1..N 正文中出现过
- 如果当前文件原本存在，对比 `.backup-xxx`，抽查 5-10 个 key 确认用户手工修正版本都被保留
- 任何异常立刻停下报告，**不要**强制写入

### 2.4 阶段 C：输出本书报告

```
=== 书：<书名> 处理完毕 ===

[每个文件单独一小节]

### particle_ledger.md（资源账本）
- 类别：SCHEMA 迁移 + 合并
- 当前文件单文件备份：.backup-<timestamp>
- 快照行数趋势（恢复前）：s0=1, s1=5, s2=10, ..., s12=73
- 快照行数趋势（恢复后）：s0=1, s1=5, s2=15, ..., s12=98
- 当前文件行数：恢复前 73 → 恢复后 98
- schema 迁移：6 列 → 7 列，分配 X 个 事件ID
- 状态：✅ 已恢复

### emotional_arcs.md（情感弧线）
[同上]

### pending_hooks.md（伏笔池）
[同上]

### subplot_board.md（支线进度板）
[同上]

### character_matrix.md（角色交互矩阵）
- 类别：LLM 重建
- LLM 调用次数：12 次
- 从扁平单表重建为 3 子表 / 或 3 子表验证通过无需重建
- 状态：✅ 已恢复

本书总耗时：约 X 分钟（包含 Y 次 LLM 调用）
```

### 2.5 本书处理完后停下等下一步指令

```
=== 等待用户决定 ===

<书名> 处理完毕。

请回复：
  NEXT    = 继续处理下一本书
  REPORT  = 先看看某个文件的恢复结果（请指明哪个文件）
  STOP    = 中止流程，不处理剩余书

【等待你的回复。不要自动继续。】
```

**必须停下等回复**。不要自动进入下一本书。

## 步骤 3：所有书处理完成或被中止时的总结

当所有选定的书都处理完（或用户输入 STOP），输出总结表格：

```
=== 数据恢复总结 ===

| 序号 | 书名 | particle_ledger | emotional_arcs | pending_hooks | subplot_board | character_matrix |
|------|------|-----------------|----------------|---------------|---------------|------------------|
| 1 | 书A | ✅ (12 事件ID分配) | ✅ (15 行恢复) | ✅ | ✅ | ✅ (LLM x12) |
| 2 | 书B | ⚠️ (当前文件缺失) | ✅ | ✅ | ⚠️ (快照全空) | ✅ (LLM x2) |
| 3 | 书C | ⏭️ 跳过 | ⏭️ 跳过 | ⏭️ 跳过 | ⏭️ 跳过 | ⏭️ 跳过 |

符号说明：
  ✅ = 成功恢复
  ⚠️ = 部分恢复（原因已在单书报告里说明）
  ❌ = 无法恢复
  ⏭️ = 用户选择跳过

总 LLM 调用：X 次
总耗时：约 Y 分钟
总备份文件：Z 个（分布在各书的 story/*.backup-* 路径）
```

最后明确问一句：

```
=== 结束确认 ===
以上报告完整吗？如果你发现任何异常、数据丢失、或不一致，请立即告诉我，我们可以：
  1. 从 .backup-* 恢复原状
  2. 针对某本书重新执行恢复
  3. 检查某个具体文件的 before/after 差异

否则，数据恢复任务完成，你可以关闭这个 session。
```

---

# 算法

## 算法 1：key-based 合并（emotional_arcs / pending_hooks / subplot_board）

这 3 个文件都是单表结构，用统一的"按 key 递增合并"算法：

| 文件 | 合并 key（列索引）| `chapter_col` |
|------|-------------------|---------------|
| emotional_arcs.md | `[0, 1]` = `[角色, 章节]` | 1 |
| pending_hooks.md | `[0]` = `[hook_id]` | `None` |
| subplot_board.md | `[0]` = `[支线ID]` | `None` |

**`chapter_col` 的含义**：
- 有章节列的文件（emotional_arcs 的 `章节` 在第 1 列），在处理 snapshot N 时**只保留 `row[chapter_col] == N` 的行**，避免把后章节抄的历史行重复计入
- 没有章节列的文件（hooks/subplots 是"实体当前状态"），snapshot N 里所有行都作为"截至第 N 章"的状态直接参与合并

**统一算法伪代码**：

```python
def recover_file(book_dir, filename, key_cols, chapter_col=None):
    from collections import OrderedDict
    accumulated = OrderedDict()  # key → row

    # 扫描 snapshots/ 取最大 N
    snaps_dir = f"{book_dir}/story/snapshots"
    if not os.path.exists(snaps_dir):
        max_n = 0
    else:
        max_n = max((int(d) for d in os.listdir(snaps_dir) if d.isdigit()), default=0)

    header = None
    separator = None

    # 阶段 1：递增处理每个快照
    for N in range(1, max_n + 1):
        snap_path = f"{snaps_dir}/{N}/{filename}"
        if os.path.exists(snap_path):
            lines = open(snap_path).read().split("\n")
            rows, h, s = parse_markdown_table(lines)
            if h: header = h
            if s: separator = s
            for row in rows:
                if chapter_col is not None:
                    try:
                        if int(row[chapter_col]) != N:
                            continue
                    except ValueError:
                        continue
                key = tuple(row[i] for i in key_cols)
                accumulated[key] = row

        # 写快照 N = 当前 accumulated 状态（即使当前快照文件本来不存在，也要创建）
        write_markdown_table(snap_path, header, separator, list(accumulated.values()))

    # 阶段 2：合并当前文件（当前文件优先级最高）
    cur_path = f"{book_dir}/story/{filename}"
    if os.path.exists(cur_path):
        lines = open(cur_path).read().split("\n")
        rows, h, s = parse_markdown_table(lines)
        if h: header = h
        if s: separator = s
        for row in rows:
            key = tuple(row[i] for i in key_cols)
            accumulated[key] = row  # 当前文件覆盖 accumulated 同 key 行

    write_markdown_table(cur_path, header, separator, list(accumulated.values()))
```

**关键点**：
1. 阶段 1 每一步都要写快照，每个 `snapshots/N/` 收到的是"加入了 ch N 贡献之后的 accumulated 快照"
2. 阶段 2 当前文件优先 —— 保留用户手工修正版本
3. 快照文件缺失容错 —— 跳过读操作但仍要写

## 算法 2：资源账本 schema 迁移（仅 particle_ledger.md 用）

particle_ledger.md 比其他 4 个文件多一步：**先从 6 列迁移到 7 列**（补充 `事件ID` 列），再按 key-based 合并（`key_cols = [6]`、`chapter_col = 0`）。

### 迁移步骤（对每个 snapshot N 和当前文件都执行）

对每个要迁移的账本文件：

1. **解析现有表格**，提取所有数据行
2. **判断 schema**：
   - 如果 header 有 6 列（`章节 | 资源名称 | 期初 | 变动 | 期末 | 事由`）→ 需要迁移
   - 如果 header 已有 7 列且第 7 列是 `事件ID` 或 `EventID` → 已经是新 schema，跳过迁移步骤，直接进入合并
3. **改造 header 和 separator** 加上 `事件ID` 列（中文文件用 `事件ID`，英文文件用 `EventID`。判断方式：如果 header 第 0 列是 `Chapter` 或 `chapter` 即为英文，否则为中文）
4. **给每一行分配 事件ID**，规则：
   - 对每个数据行，记录它的 `(章节, 资源名称)` 组合
   - 维护一个计数器 `Map<(章节, 资源名称), int>`，初值 0
   - 每遇到一行，该组合的计数器 +1，序号就是当前计数
   - `事件ID = ch{章节}-{资源名称}-{序号}`，例如：
     - ch1 第一个 灵石 事件 → `ch1-灵石-1`
     - ch1 第二个 灵石 事件 → `ch1-灵石-2`（如果有的话）
     - ch4 第一个 情报权 事件 → `ch4-情报权-1`
     - ch4 第二个 情报权 事件 → `ch4-情报权-2`
     - ch4 第三个 情报权 事件 → `ch4-情报权-3`
     - ch4 第四个 情报权 事件 → `ch4-情报权-4`
5. **特殊处理初始行**：如果第一行是 `| 0 | - | 0 | 0 | 0 | 开书初始 |`（或英文等价 `| 0 | - | 0 | 0 | 0 | Initial book state |`），事件ID 用 `init-0`，不走通用规则
6. **写回文件**，新 schema 7 列格式

### 迁移示例

**迁移前（6 列）**：

```markdown
# 资源账本

| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 |
|------|----------|------|------|------|------|
| 0 | - | 0 | 0 | 0 | 开书初始 |
| 1 | 灵石 | 0 | +50 | 50 | 初次采矿 |
| 4 | 情报权 | 27 | +1 | 28 | 顾家再次来人 |
| 4 | 情报权 | 28 | +1 | 29 | 周巡事查明 |
| 4 | 情报权 | 29 | +1 | 30 | 旧单缺失 |
| 4 | 情报权 | 30 | +1 | 31 | 徐老从脉象 |
```

**迁移后（7 列）**：

```markdown
# 资源账本

| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |
|------|----------|------|------|------|------|--------|
| 0 | - | 0 | 0 | 0 | 开书初始 | init-0 |
| 1 | 灵石 | 0 | +50 | 50 | 初次采矿 | ch1-灵石-1 |
| 4 | 情报权 | 27 | +1 | 28 | 顾家再次来人 | ch4-情报权-1 |
| 4 | 情报权 | 28 | +1 | 29 | 周巡事查明 | ch4-情报权-2 |
| 4 | 情报权 | 29 | +1 | 30 | 旧单缺失 | ch4-情报权-3 |
| 4 | 情报权 | 30 | +1 | 31 | 徐老从脉象 | ch4-情报权-4 |
```

### 迁移后的 key-based 合并

所有快照和当前文件都迁移到 7 列之后，用算法 1 继续处理：
- `key_cols = [6]`（只用 事件ID 列）
- `chapter_col = 0`（章节列在第 0 位，用于过滤 snapshot N 里的外章行）

合并会正确处理：
- ch4 情报权 4 条独立事件 → 4 个不同 事件ID → 全部保留
- 后续章节 reviser 改写同一事件 → 相同 事件ID → 覆盖
- 新章节引入新事件 → 新 事件ID → 追加

## 算法 3：character_matrix LLM 重建（仅 character_matrix.md 用）

character_matrix.md 的当前状态可能是**扁平单表**（只有角色档案一节的列），需要重建成**3 子表**格式匹配上游 schema：
- `### 角色档案`
- `### 相遇记录`
- `### 信息边界`

不能用合并算法，因为：
1. 新格式有 `相遇记录` 和 `信息边界` 两个小节在旧数据里完全不存在
2. LLM 需要从章节正文里推断角色对关系和信息边界
3. 扁平单表的列和新格式的 `角色档案` 子表列可能不一致，也需要 LLM 重新整理

### 重建判断

在调 LLM 之前，**先判断是否真的需要重建**：

1. 读当前 `character_matrix.md`
2. 检查它是否包含 `### 角色档案` 且包含 `### 相遇记录` 且包含 `### 信息边界` 这 3 个子表标题
3. 如果 3 个都在 → **已经是新 schema，不需要 LLM 重建**，直接跳过算法 3，输出"无需重建"状态
4. 如果缺任何一个 → 需要 LLM 重建，执行下面的步骤

### 重建步骤

对每本需要重建的书：

1. **读取这本书的所有章节正文**（`{book_dir}/chapters/*.md`）、当前 `character_matrix.md`（作为参考角色清单）、`volume_outline.md`、`story_bible.md`（作为背景）

2. **扫描 `snapshots/` 取最大 N**（如果无快照，max_N = 当前章节数 / 从 `chapters/` 目录推断）

3. **对 N 从 1 到 max_N 递增生成每个快照**：
   - 读取章节 1 到 N 的正文内容
   - 发给 LLM 一个 prompt（模板见下），要求它基于 ch1..N 正文输出一个 3 子表 character_matrix
   - 验证输出确实包含 3 个 `### ` 子表标题；如果不符合，重试一次；仍不符合则记录错误并跳过该快照
   - 写入 `snapshots/N/character_matrix.md`

4. **当前文件 = `snapshots/{max_N}/character_matrix.md` 的内容**（因为当前文件就是 "截至最新章" 的累积版本）

### LLM Prompt 模板（发给 LLM 用来重建一个 snapshot 的）

```
请根据下面提供的章节正文和参考资料，输出一个角色交互矩阵 Markdown，必须严格遵守以下 3 子表格式：

### 角色档案
| 角色 | 核心标签 | 反差细节 | 说话风格 | 性格底色 | 与主角关系 | 核心动机 | 当前目标 |
|------|----------|----------|----------|----------|------------|----------|----------|
（每行一个角色。只包含在 ch1 至 ch{N} 正文中已经出场或被明确提及的角色。）

### 相遇记录
| 角色A | 角色B | 首次相遇章 | 最近交互章 | 关系性质 | 关系变化 |
|-------|-------|------------|------------|----------|----------|
（每行一对角色的关系。首次相遇章 必须 <= {N}，最近交互章 必须 <= {N}。不要为从未交互的角色对创建行。）

### 信息边界
| 角色 | 已知信息 | 未知信息 | 信息来源章 |
|------|----------|----------|------------|
（每行一条"某角色知道/不知道某关键信息"的记录。信息来源章 必须 <= {N}。重点记录会影响后续剧情的信息落差。）

## 硬性规则
1. 只根据正文实际描写生成数据，不要推断、预测、补充正文没写的东西
2. 所有章节号字段必须是整数且 <= {N}
3. 3 个子表的表头格式必须和上面的模板完全一致
4. 如果某个子表没有数据，也要保留表头和分隔行，不要整块删除
5. 输出顺序：### 角色档案 → ### 相遇记录 → ### 信息边界

## 参考资料

### Story Bible（世界观）
{story_bible.md 的内容，最多 3000 字，超过截断}

### Volume Outline（卷纲）
{volume_outline.md 的内容，最多 2000 字，超过截断}

### 当前 character_matrix（仅作为角色名清单参考，格式会被替换掉）
{当前 character_matrix.md 的内容}

### 章节正文（ch1 到 ch{N}）

#### 第 1 章
{第 1 章正文内容}

#### 第 2 章
{第 2 章正文内容}

...

#### 第 {N} 章
{第 N 章正文内容}

---

请现在输出 3 子表 character_matrix Markdown，不要任何额外解释或 code fence。
```

### 实现建议

- **LLM 调用数量**：每本书需要 `max_N` 次调用
- **token 开销**：每次调用要读全部 ch1..N 正文，后期章节的调用会很大。如果单次 prompt 超过模型窗口，可以**只输出 ch(N-2)..N 的正文 + 截至 ch(N-3) 的旧 character_matrix（来自 snapshot N-3）作为累积基础**，让 LLM 做"增量更新"而不是全量重建
- **复用已生成的 snapshot**：生成 snapshot N 时可以把 snapshot N-1 的内容传给 LLM 作为"起点"，然后让 LLM 根据 ch N 的正文做增量更新。这样避免每次都从零开始
- **如果 LLM API 不可用**：停下来报告"character_matrix LLM 重建需要 LLM API，当前环境不可用，已跳过 character_matrix 的重建，其他 4 个文件正常处理"。不要 fallback 到机械脚本

---

# 报告格式参考

每本书报告模板（在步骤 2.4 阶段 C 使用）：

```
### <书名>/story/<文件名>（<中文名>）
- 类别：<SCHEMA 迁移 + 合并 / 合并 / LLM 重建 / 无需重建>
- 当前文件单文件备份：.backup-<timestamp>（或 "当前文件缺失，未备份"）
- 快照行数趋势（恢复前）：s0=4, s1=8, s2=缺失, s3=10, ..., s12=10
- 快照行数趋势（恢复后）：s0=4, s1=8, s2=10, s3=15, ..., s12=72
- 当前文件行数：恢复前 10 → 恢复后 72
- 识别到的突降：s8→s9（40→14，丢失约 26 行）
- 恢复的章节贡献：ch1-11 的条目被补回
- [particle_ledger 额外] schema 迁移：6 列 → 7 列，分配 事件ID N 个
- [character_matrix 额外] LLM 调用次数：N 次
- 状态：✅ 已恢复 / ⚠️ 部分恢复（原因）/ ❌ 无法恢复（原因）/ ⏭️ 无需重建
```

---

# 给代理的最终提醒（READ THIS BEFORE STEP 0）

如果你是 **Claude Code**：  
你通常很擅长按约束执行。请严格遵守步骤 1.5、2.1、2.5 的"停下等用户回复"。不要尝试并发或跳步。

如果你是 **Codex CLI / OpenAI Codex**：  
你倾向于快速完成任务并自动推进。本 prompt 的每一个"等待用户回复"都是**硬性停止点**，不是可选的建议。**禁止自动假设用户想继续**。每一个确认点必须真的等到用户文字回复才能继续。

如果你是**任何其他 agent**：  
同上。规则对所有 agent 都一样严格。

现在开始步骤 0（权限预检查）。
