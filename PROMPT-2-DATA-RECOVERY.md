# Prompt 2：inkOS 数据恢复（修订 v3）

> 使用方式：把下面分隔线以下的全部内容复制到新的 Claude Code 会话里。
> 不要在 Codex 环境执行（写权限问题）。

---

请按以下步骤检查并恢复 inkOS 已知书籍的历史真相文件丢失情况。

## ⚠️ 第一步：权限预检查（必须先做）

在任何恢复操作之前，先测试对 /Users/admin/.inkos/data/ 的写权限：

```bash
touch /Users/admin/.inkos/data/.write-test && rm /Users/admin/.inkos/data/.write-test
```

如果这一步失败（因为 Codex 或其他环境的权限限制不在可写根目录），立刻停止并报告：

**"当前环境对 /Users/admin/.inkos/data/ 没有写权限，无法执行数据恢复。请在宿主机的普通 shell 或 Claude Code 中执行此 prompt。"**

不要尝试任何替代路径（/tmp、项目目录下的副本等），直接报告停止。

## ⚠️ 第二步：范围限制（必做）

**本次只处理以下两本书，不要一次性扫所有书**：

1. /Users/admin/.inkos/data/books/镜源逆刻/
2. /Users/admin/.inkos/data/books/长夜/

两本书处理完并汇报结果后，**停下来**等用户确认是否继续处理其他书。不要自作主张扩大范围。

如果发现以上任一目录不存在，跳过那本书并在报告里明确标记 "目录不存在"，不要报错退出。

## 背景

v0.2.2.6 修了 5 个 bug（Bug A-E），包括 runner.ts 新增 4 个真相文件的 merge 兜底。但这些 merge 保护**只能防止未来数据丢失**，不会回填已经丢失的历史条目。历史数据需要从快照里手工回补。

同时 v0.2.2.6 对 particle_ledger.md 做了**schema 改造**：从原本的 6 列（章节/资源名称/期初/变动/期末/事由）变为 7 列，新增第 7 列 `事件ID` 作为唯一 merge key。旧书的 particle_ledger.md 需要迁移到新 schema。

character_matrix.md 的情况不同：代码层面（writer prompt + scaffold + merge 函数）一直是 3 子表结构（`### 角色档案` / `### 相遇记录` / `### 信息边界`），但镜源逆刻当前的 character_matrix.md 是扁平单表（只有 `角色档案` 一节的列）。需要用 LLM 根据章节正文重建成 3 子表格式。

## 核心约束：快照语义必须保持

快照 `snapshots/N/` 的语义是"**写完第 N 章后当时的累积状态**"（参见 /Users/admin/Codex/Project/inkOS/packages/core/src/state/manager.ts:235），不是"最终结果的副本"。

所以：
- **当前文件**（`story/<file>.md`）：写入恢复后的**最终**结果
- **每个快照 `snapshots/N/`**：写入"**截至第 N 章**"的累积状态，必须**递增生成**

**绝对禁止**：
- ❌ 用一个最终结果批量覆盖所有 `snapshots/`
- ❌ 向 `snapshots/N/` 写入 N 章之后才出现的数据
- ❌ 修改 `snapshots/N/current_state.md`（即使它"看起来"不对，那是当时的真实状态）

## 7 个真相文件的分类

| # | 文件 | 中文名 | 类别 | 本次处理 |
|---|------|--------|------|---------|
| 1 | particle_ledger.md | **资源账本** | SCHEMA 迁移 + 按 事件ID 合并 | ✅ 需迁移 + 恢复 |
| 2 | emotional_arcs.md | **情感弧线** | 按 [角色,章节] key 合并 | ✅ 需恢复 |
| 3 | pending_hooks.md | **伏笔池** | 按 [hook_id] key 合并 | ✅ 需恢复 |
| 4 | subplot_board.md | **支线进度板** | 按 [支线ID] key 合并 | ✅ 需恢复 |
| 5 | character_matrix.md | **角色交互矩阵** | **LLM 按章节正文重建 3 子表** | ✅ 需 LLM 重建 |
| 6 | chapter_summaries.md | **章节摘要** | 纯追加，bug 不影响 | ❌ 不处理 |
| 7 | current_state.md | **当前状态卡** | 每章整块覆盖，绝对不动快照 | ❌ 不处理 |

## 算法 1：key-based 合并（用于 emotional_arcs / pending_hooks / subplot_board）

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
    max_n = max(int(d) for d in os.listdir(snaps_dir) if d.isdigit())

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

        # 写快照 N = 当前 accumulated 状态
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
   - 如果 header 已有 7 列且第 7 列是 `事件ID` 或 `EventID` → 已经是新 schema，跳过迁移
3. **改造 header 和 separator** 加上 `事件ID` 列（中文文件用 `事件ID`，英文文件用 `EventID`）
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
5. **特殊处理初始行**：如果第一行是 `| 0 | - | 0 | 0 | 0 | 开书初始 |`（或英文等价），事件ID 用 `init-0`，不走通用规则
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

character_matrix.md 的当前状态是**扁平单表**（只有角色档案一节），需要重建成**3 子表**格式匹配上游 schema。不能用合并算法，因为：

1. 新格式有 `### 相遇记录` 和 `### 信息边界` 两个小节在旧数据里完全不存在
2. LLM 需要从章节正文里推断角色对关系和信息边界
3. 单表的 8 列 schema 和新格式的 `角色档案` 子表列不一致，也需要 LLM 重新整理

### 重建步骤

对每本书：

1. **读取这本书的所有章节正文**（`{book_dir}/chapters/*.md`）、当前 `character_matrix.md`（作为参考角色清单）、volume_outline.md、story_bible.md（作为背景）

2. **扫描 `snapshots/` 取最大 N**

3. **对 N 从 1 到 max_N 递增生成每个快照**：
   - 读取章节 1 到 N 的正文内容
   - 发给 LLM 一个 prompt，要求它基于 ch1..N 正文输出一个 3 子表 character_matrix，格式严格遵守 scaffold
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
{story_bible.md 的内容}

### Volume Outline（卷纲）
{volume_outline.md 的内容}

### 当前扁平 character_matrix（仅作为角色名清单参考，格式会被替换掉）
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

- **LLM 调用数量**：每本书需要 `max_N` 次调用。镜源逆刻 max_N = 12 → 12 次，长夜 max_N = 2 → 2 次。总共 14 次。
- **token 开销**：每次调用要读全部 ch1..N 正文，后期章节的调用会很大。如果单次 prompt 超过模型窗口，可以**只输出 ch(N-2)..N 的正文 + 截至 ch(N-3) 的旧 character_matrix（来自 snapshot N-3）作为累积基础**，让 LLM 做"增量更新"而不是全量重建
- **复用已生成的 snapshot**：生成 snapshot N 时可以把 snapshot N-1 的内容传给 LLM 作为"起点"，然后让 LLM 根据 ch N 的正文做增量更新。这样避免每次都从零开始
- **如果 API 不可用**：停下来报告"character_matrix LLM 重建需要 LLM API，当前环境不可用，已跳过 character_matrix 的重建，其他 4 个文件正常处理"。不要 fallback 到机械脚本。

## 已处理不要重复覆盖的文件

以下文件在之前的会话已经手工恢复，本次恢复要**迁移到 7 列 schema** 并**检查一致性**而不是重建：

- `/Users/admin/.inkos/data/books/镜源逆刻/story/particle_ledger.md`
  - 已恢复 ch1-5（ch1-3 从旧 8 列 schema 转换为 6 列）
  - 情报权 ch6-12 已整体 +11 偏移
  - **不要再次偏移情报权**
  - **本次要做的事**：按算法 2 把这个 6 列文件迁移到 7 列（加 事件ID 列），再按算法 1 跑 snapshot 递增合并

- `/Users/admin/.inkos/data/books/镜源逆刻/story/pending_hooks.md`
  - 已恢复 14 个远期钩子（H006, H007, H009-H020）
  - 已按 hook_id 排序
  - **本次要做的事**：按算法 1 跑 snapshot 递增合并，检查是否和当前手工恢复版一致

对两本书的其他文件（emotional_arcs / subplot_board / character_matrix）以及长夜的全部 5 个文件，**按算法正常处理**。

## 执行流程

### 阶段 A：每本书开始处理前的初始化（每本书只做一次）

1. **整体备份 `snapshots/` 目录**：
   ```bash
   cp -r /Users/admin/.inkos/data/books/<书名>/story/snapshots \
         /Users/admin/.inkos/data/books/<书名>/story/snapshots.backup-$(date +%Y%m%d%H%M%S)
   ```
   如果失败（比如 `snapshots/` 目录不存在），记录并停下来报告，跳过这本书但不要退出整个流程。

2. **记录本书基本信息**：
   - 书名
   - `snapshots/` 下的最大章节号 max_N
   - 要处理的 5 个文件列表
   - 缺失的快照编号列表（用于报告）

### 阶段 B：对每个文件单独执行

处理顺序（**严格按此顺序**）：

1. **particle_ledger.md** —— 先迁移到 7 列再合并（算法 2 + 算法 1）
2. **emotional_arcs.md** —— 算法 1，`key_cols=[0,1]`、`chapter_col=1`
3. **pending_hooks.md** —— 算法 1，`key_cols=[0]`、`chapter_col=None`
4. **subplot_board.md** —— 算法 1，`key_cols=[0]`、`chapter_col=None`
5. **character_matrix.md** —— 算法 3，LLM 重建

每个文件处理前：

#### 步骤 1：备份当前文件（条件化）

```
如果 当前文件存在:
    cp /Users/admin/.inkos/data/books/<书名>/story/<文件名> \
       /Users/admin/.inkos/data/books/<书名>/story/<文件名>.backup-$(date +%Y%m%d%H%M%S)
如果 不存在:
    记录 "当前文件缺失"，不视为失败，继续后续步骤
```

#### 步骤 2：分析丢失情况（容错）

```
对每个快照目录 N（按数字升序）：
  如果 snapshots/N/<文件名> 存在：记录行数
  如果 不存在：记录 "无该快照文件"，不算失败

对当前文件：
  如果 存在：记录行数
  如果 不存在：记录 "当前文件缺失"
```

识别突降点（行数突然远小于前一个快照）—— 这是典型的 bug 覆写痕迹。

#### 步骤 3：执行恢复

严格按对应算法执行。

#### 步骤 4：验证

- 重新统计快照行数趋势，确认单调递增或至少不倒退
- 对 particle_ledger：
  - 验证每个 snapshot N 里 `row[0]`（章节列） > N 的行数为 0
  - 验证 事件ID 列所有值都非空且符合格式（`ch{章节}-{资源}-{序号}` 或 `init-0` 或 `auto-ch{章节}-{hash}`）
  - 抽查 5-10 个 事件ID 确认相同事件在快照间保持相同 ID
- 对 emotional_arcs：验证每个快照 N 里 `row[1]`（章节列） > N 的行数为 0
- 对 pending_hooks / subplot_board：验证所有 id 都在当前文件中
- 对 character_matrix：
  - 验证每个快照包含 3 个 `### ` 子表
  - 验证没有引用 N 章之后才出现的章节号
  - 抽查：snapshot N 的 `角色档案` 里的角色是否都在 ch1..N 正文中出现过
- 如果当前文件原本存在，对比 `.backup-xxx`，抽查 5-10 个 key 确认用户手工修正版本都被保留
- 任何异常立刻停下报告，**不要**强制写入

## 硬性约束

1. **绝不**丢失当前文件已有的数据（当前文件 = 最新真相，优先级最高）
2. **绝不**自己编造数据
3. **绝不**改代码
4. **绝不**向 `snapshots/N/` 写入 N 章之后才出现的数据
5. **绝不**批量覆盖所有快照（每个快照必须按"截至第 N 章"的语义递增生成）
6. **绝不**修改 `snapshots/N/current_state.md`
7. **绝不**对不存在的文件执行 `cp` 备份（会报错）
8. **绝不**在处理单个文件时重复整体备份 `snapshots/`（只在阶段 A 做一次）
9. **绝不** import 或调用 inkOS 源码里的 TypeScript 合并函数（避免 runtime 依赖）—— 要自己用 Python/node/bash 实现算法 1 和 算法 2
10. **绝不**对 character_matrix 走算法 1（机械合并），它必须走算法 3（LLM 重建）
11. **必须**用绝对路径引用所有文件
12. **必须**先检查权限再动工
13. **必须**把文件缺失视为"该快照无该文件"而不是失败
14. **必须** `snapshots/` 整体备份每本书只做一次
15. **必须**迁移 particle_ledger.md 到 7 列 schema 之后，才跑合并
16. 本次只处理 2 本书（镜源逆刻 + 长夜），处理完停下等用户确认

## 报告格式

每本书开头先报告：

```
## 书：<书名>
- snapshots/ 整体备份：/Users/admin/.inkos/data/books/<书名>/story/snapshots.backup-<timestamp>
- snapshots/ 最大章节号：N
- 缺失快照：[列表，或 "无"]
- 要处理的 5 个文件：particle_ledger.md / emotional_arcs.md / pending_hooks.md / subplot_board.md / character_matrix.md
```

对每个文件报告：

```
### <书名>/story/<文件名>（<中文名>）
- 类别：<SCHEMA 迁移 + 合并 / 合并 / LLM 重建>
- 当前文件单文件备份：.backup-<timestamp>（或 "当前文件缺失，未备份"）
- 快照行数趋势（恢复前）：s0=4, s1=8, s2=缺失, s3=10, ..., s12=10
- 快照行数趋势（恢复后）：s0=4, s1=8, s2=10, s3=15, ..., s12=72
- 当前文件行数：恢复前 10 → 恢复后 72
- 识别到的突降：s8→s9（40→14，丢失约 26 行）
- 恢复的章节贡献：ch1-11 的条目被补回
- [particle_ledger 额外] schema 迁移：6 列 → 7 列，分配 事件ID N 个
- [character_matrix 额外] LLM 调用次数：N 次
- 状态：✅ 已恢复 / ⚠️ 部分恢复（原因）/ ❌ 无法恢复（原因）
```

两本书全部处理完后，输出总结表格：

```
| 书名 | 文件 | 中文名 | 状态 | 恢复章节范围 | 快照同步 | 备注 |
|------|------|--------|------|-------------|---------|------|
| 镜源逆刻 | particle_ledger.md | 资源账本 | ✅ | ch1-12 | ✅ 递增生成 | schema 迁移 6→7 列，分配 X 个 事件ID，保留 ch4 情报权 4 条 |
| 镜源逆刻 | emotional_arcs.md | 情感弧线 | ✅ | ch1-12 | ✅ 递增生成 | 恢复约 X 行 |
| 镜源逆刻 | pending_hooks.md | 伏笔池 | ✅ | ch1-12 | ✅ 递增生成 | 保留之前手工恢复的 14 个远期钩子 |
| 镜源逆刻 | subplot_board.md | 支线进度板 | ✅ | ch1-12 | ✅ 递增生成 | |
| 镜源逆刻 | character_matrix.md | 角色交互矩阵 | ✅ | ch1-12 | ✅ 每个快照 LLM 重建 | 从扁平单表重建为 3 子表，LLM 调用 12 次 |
| 长夜 | particle_ledger.md | 资源账本 | ... | ... | ... | |
| 长夜 | ... | ... | ... | ... | ... | |
```

最后明确说一句：**"两本书处理完毕，是否继续处理其他书？（等待用户确认）"**

## 本次修订相对上一版（v2）的关键变化

1. **particle_ledger 增加 schema 迁移步骤**：从 6 列迁移到 7 列（加 事件ID 列），迁移规则是确定性的脚本（不需要 LLM）
2. **particle_ledger 的 merge key 从 `[0,1,5]` 改为 `[6]`**（只用 事件ID 列），匹配 v0.2.2.6 的 runtime 实现
3. **character_matrix 从"扁平单表按 [0] 合并"改为"LLM 按章节正文重建 3 子表"**，对齐 writer prompt 和 scaffold 的上游 3-section schema
4. **废弃类别 I/II/III 三分法**，改为按处理方式分类：SCHEMA 迁移 + 合并 / key-based 合并 / LLM 重建
5. **明确禁止 import TypeScript 合并函数**，恢复脚本必须用独立语言（Python/node/bash）重新实现
