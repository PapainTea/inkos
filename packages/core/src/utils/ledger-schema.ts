/**
 * Unified resource ledger schema.
 *
 * Single source of truth for the particle_ledger.md table format.
 * Every prompt and merge call that touches the ledger must reference
 * these constants instead of hardcoding its own header strings.
 *
 * Schema: 7 columns. The last column `事件ID` is a stable identifier for
 * each resource event. Merge semantics use only the 事件ID column so that:
 *   - Reviser rewrites (same event, updated details) → same 事件ID → overwrite
 *   - Multi-event first writes (e.g. 4 independent ch4 情报权 events) → distinct
 *     事件IDs → all preserved
 *   - New events introduced later → new 事件ID → appended
 *
 * The LLM is required to generate stable 事件IDs (see ledgerSchemaInstruction).
 * If the LLM leaves the cell blank, `normalizeLedgerMarkdown` in
 * `./truth-file-persistence.ts` fills it with a deterministic content hash
 * as a fallback.
 */

// ── Column layout ──

/** Merge key: only the 事件ID column (index 6). */
export const LEDGER_KEY_COLUMNS: readonly [number] = [6] as const;

export const LEDGER_COLUMN_COUNT = 7;

// ── Chinese ──

export const LEDGER_HEADER_ZH = "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |";
export const LEDGER_SEPARATOR_ZH = "|------|----------|------|------|------|------|--------|";

export const LEDGER_INITIAL_ZH = [
  "# 资源账本",
  "",
  LEDGER_HEADER_ZH,
  LEDGER_SEPARATOR_ZH,
  "| 0 | - | 0 | 0 | 0 | 开书初始 | init-0 |",
  "",
].join("\n");

// ── English ──

export const LEDGER_HEADER_EN = "| Chapter | Resource | Opening | Delta | Closing | Reason | EventID |";
export const LEDGER_SEPARATOR_EN = "|---------|----------|---------|-------|---------|--------|---------|";

export const LEDGER_INITIAL_EN = [
  "# Resource Ledger",
  "",
  LEDGER_HEADER_EN,
  LEDGER_SEPARATOR_EN,
  "| 0 | - | 0 | 0 | 0 | Initial book state | init-0 |",
  "",
].join("\n");

// ── Prompt fragments ──

export const LEDGER_SCHEMA_INSTRUCTION_ZH = `=== UPDATED_LEDGER ===
（输出更新后的完整资源账本表格。）
表头必须严格使用以下格式，不得改列名、不得增删列：
${LEDGER_HEADER_ZH}
${LEDGER_SEPARATOR_ZH}

每一行是本章发生的一个资源事件。**事件ID 列规则（极其重要）**：
1. 格式：\`ch{章节号}-{资源名slug}-{序号}\`，例如 \`ch4-情报权-2\`。slug 允许中文，序号从 1 开始。
2. 同一个 (章节, 资源名称) 内有多个独立事件时，序号递增：\`ch4-情报权-1\`、\`ch4-情报权-2\`、\`ch4-情报权-3\`。
3. **修正已有事件**：如果你在修正"当前资源账本"里已经存在的某一行，**必须复用该行原来的 事件ID**，不要重新生成新 ID。这样合并器才能正确覆盖旧版本。
4. **新增事件**：如果这是一个全新的事件（当前账本里不存在），生成一个当前未使用的新 事件ID。
5. 验算：期初 + 变动 = 期末。`;

export const LEDGER_SCHEMA_INSTRUCTION_EN = `=== UPDATED_LEDGER ===
(Output the fully updated resource ledger table.)
The header MUST use the exact format below — do NOT rename, add, or remove columns:
${LEDGER_HEADER_EN}
${LEDGER_SEPARATOR_EN}

Each row is one resource event in the chapter. **EventID column rules (critical)**:
1. Format: \`ch{chapter}-{resource_slug}-{seq}\`, e.g. \`ch4-intel-2\`. Sequence starts from 1.
2. Multiple independent events with the same (chapter, resource) use incrementing sequences: \`ch4-intel-1\`, \`ch4-intel-2\`, \`ch4-intel-3\`.
3. **Revising an existing event**: if you are correcting a row that already exists in the "current ledger", **you MUST reuse that row's original EventID**, do not mint a new one. This is how the merge layer knows to overwrite instead of append.
4. **New events**: if this event does not exist in the current ledger yet, pick an EventID that is not already in use.
5. Arithmetic rule: Opening + Delta = Closing.`;

/** Pick the appropriate instruction based on language. */
export function ledgerSchemaInstruction(language: "zh" | "en"): string {
  return language === "en" ? LEDGER_SCHEMA_INSTRUCTION_EN : LEDGER_SCHEMA_INSTRUCTION_ZH;
}

/** Pick the appropriate initial ledger based on language. */
export function ledgerInitial(language: "zh" | "en"): string {
  return language === "en" ? LEDGER_INITIAL_EN : LEDGER_INITIAL_ZH;
}
