/**
 * Unified resource ledger schema.
 *
 * Single source of truth for the particle_ledger.md table format.
 * Every prompt and merge call that touches the ledger must reference
 * these constants instead of hardcoding its own header strings.
 */

// ── Column layout ──

export const LEDGER_KEY_COLUMNS: readonly [number, number] = [0, 1] as const;

export const LEDGER_COLUMN_COUNT = 6;

// ── Chinese ──

export const LEDGER_HEADER_ZH = "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 |";
export const LEDGER_SEPARATOR_ZH = "|------|----------|------|------|------|------|";

export const LEDGER_INITIAL_ZH = [
  "# 资源账本",
  "",
  LEDGER_HEADER_ZH,
  LEDGER_SEPARATOR_ZH,
  "| 0 | - | 0 | 0 | 0 | 开书初始 |",
  "",
].join("\n");

// ── English ──

export const LEDGER_HEADER_EN = "| Chapter | Resource | Opening | Delta | Closing | Reason |";
export const LEDGER_SEPARATOR_EN = "|---------|----------|---------|-------|---------|--------|";

export const LEDGER_INITIAL_EN = [
  "# Resource Ledger",
  "",
  LEDGER_HEADER_EN,
  LEDGER_SEPARATOR_EN,
  "| 0 | - | 0 | 0 | 0 | Initial book state |",
  "",
].join("\n");

// ── Prompt fragments ──

export const LEDGER_SCHEMA_INSTRUCTION_ZH = `=== UPDATED_LEDGER ===
（如有数值系统：输出更新后的完整资源账本表格。无则留空。）
表头必须严格使用以下格式，不得改列名、不得增删列：
${LEDGER_HEADER_ZH}
${LEDGER_SEPARATOR_ZH}
每项资源变动单独成行。验算铁律：期初 + 变动 = 期末。`;

export const LEDGER_SCHEMA_INSTRUCTION_EN = `=== UPDATED_LEDGER ===
(If the genre has a numerical system: output the fully updated resource ledger table. Otherwise leave empty.)
The header MUST use the exact format below — do NOT rename, add, or remove columns:
${LEDGER_HEADER_EN}
${LEDGER_SEPARATOR_EN}
Each resource change is a separate row. Rule: Opening + Delta = Closing.`;

/** Pick the appropriate instruction based on language. */
export function ledgerSchemaInstruction(language: "zh" | "en"): string {
  return language === "en" ? LEDGER_SCHEMA_INSTRUCTION_EN : LEDGER_SCHEMA_INSTRUCTION_ZH;
}

/** Pick the appropriate initial ledger based on language. */
export function ledgerInitial(language: "zh" | "en"): string {
  return language === "en" ? LEDGER_INITIAL_EN : LEDGER_INITIAL_ZH;
}
