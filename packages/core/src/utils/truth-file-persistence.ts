import { mergeTableMarkdownByKey } from "./governed-working-set.js";
import { LEDGER_KEY_COLUMNS, LEDGER_COLUMN_COUNT, ledgerInitial } from "./ledger-schema.js";

export function isLedgerSentinel(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized
    || normalized === "(账本未更新)"
    || normalized === "(ledger not updated)";
}

/**
 * Detect whether markdown content contains at least one table data row
 * (i.e. not just headers, separators, or sub-table scaffolds).
 *
 * Handles both single-table files and multi-section files like
 * character_matrix (3 `### ` sub-tables each with their own header).
 */
export function hasMarkdownTableDataRows(content: string | undefined): boolean {
  if (!content) return false;
  const headerFirstCellPattern = /^(章节|标题|出场人物|关键事件|状态变化|伏笔动态|情绪基调|章节类型|Chapter|Title|Characters|Events|支线ID|支线名|角色|角色A|hook_id|hookID|ID|起始章|类型|起始|首次相遇|已知信息|核心标签|Subplot|Character|Arc|Trigger|Intensity|Direction)/i;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;
    const firstCell = line.split("|")[1]?.trim() ?? "";
    if (!firstCell) continue;
    if (headerFirstCellPattern.test(firstCell)) continue;
    return true;
  }
  return false;
}

/**
 * Bug E safety guard: return true if content is too empty to be worth
 * writing over an existing truth file.
 *
 * - Empty / whitespace only → true (skip write)
 * - Markdown table with header+separator but zero data rows → true (skip write,
 *   LLM emitted scaffold only, would wipe history)
 * - Plain text / table with at least one data row → false (content is writeable)
 */
export function isEmptyTruthContent(content: string | undefined): boolean {
  if (!content || !content.trim()) return true;
  const hasTableStructure = content.split("\n").some((line) => line.trim().startsWith("|"));
  if (!hasTableStructure) return false;
  return !hasMarkdownTableDataRows(content);
}

/**
 * Merge chapter_summaries.md by chapter column (key=[0]).
 *
 * Preserves current entirely if incoming is empty or scaffold-only (Bug E
 * safety). Falls through to mergeTableMarkdownByKey when both sides have
 * content — that function handles schema mismatch and plain-text gracefully.
 */
export function mergeChapterSummariesMarkdown(
  current: string | undefined,
  incoming: string | undefined,
): string {
  const currentText = current ?? "";
  const incomingText = incoming ?? "";
  if (isEmptyTruthContent(incomingText)) return currentText;
  if (isEmptyTruthContent(currentText)) return incomingText;
  return mergeTableMarkdownByKey(currentText, incomingText, [0]);
}

export function isStateSentinel(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized
    || normalized === "(状态卡未更新)"
    || normalized === "(state card not updated)";
}

export function isHooksSentinel(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized
    || normalized === "(伏笔池未更新)"
    || normalized === "(hooks pool not updated)";
}

export function mergeLedgerForPersistence(
  currentLedger: string | undefined,
  incomingLedger: string | undefined,
  language: "zh" | "en",
): string | null {
  if (isLedgerSentinel(incomingLedger)) {
    return null;
  }

  const baseLedger = isLedgerSentinel(currentLedger)
    ? ledgerInitial(language)
    : currentLedger!;

  return mergeLedgerTables(baseLedger, incomingLedger!);
}

/**
 * Merge two ledger markdown tables, normalizing both first so legacy 6-column
 * input or rows with missing 事件ID get auto-filled before the merge runs.
 * Use this instead of calling `mergeTableMarkdownByKey` with LEDGER_KEY_COLUMNS
 * directly — it guarantees the event_id column exists on every row.
 */
export function mergeLedgerTables(original: string, incoming: string): string {
  const normalizedOriginal = normalizeLedgerMarkdown(original);
  const normalizedIncoming = normalizeLedgerMarkdown(incoming);
  return mergeTableMarkdownByKey(normalizedOriginal, normalizedIncoming, LEDGER_KEY_COLUMNS);
}

/**
 * Normalize a ledger markdown table so every row has all 7 columns with a
 * non-empty 事件ID (column 6). Handles both legacy 6-column files (missing
 * the 事件ID column entirely) and new 7-column files where the LLM left the
 * 事件ID cell blank.
 *
 * Auto-generated event IDs use a deterministic content hash so the same row
 * always gets the same ID. Format: `auto-ch{章节}-{hash6}`.
 *
 * This is a safety net — the preferred path is for the LLM to emit stable
 * event IDs itself (see ledgerSchemaInstruction). Auto-generated IDs behave
 * like a fallback [章节, 资源, 事由] merge key when the LLM doesn't cooperate.
 */
export function normalizeLedgerMarkdown(content: string): string {
  const lines = content.split("\n");
  const tableIndices: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim().startsWith("|")) tableIndices.push(i);
  });
  if (tableIndices.length === 0) return content;

  const headerIdx = tableIndices[0]!;
  const secondIdx = tableIndices[1];
  const hasSeparator = secondIdx !== undefined && lines[secondIdx]!.includes("---");
  const separatorIdx = hasSeparator ? secondIdx! : -1;
  const dataIndices = tableIndices.filter((i) => i !== headerIdx && i !== separatorIdx);

  const parseRow = (line: string): string[] =>
    line.split("|").slice(1, -1).map((cell) => cell.trim());

  const headerCells = parseRow(lines[headerIdx]!);
  let headerChanged = false;

  // Detect language from existing header to pick the right column label
  // (so we don't trip mergeTableMarkdownByKey's schema-mismatch guard)
  const isEnglishHeader = headerCells[0] === "Chapter"
    || headerCells[0]?.toLowerCase() === "chapter";
  const eventIdLabel = isEnglishHeader ? "EventID" : "事件ID";

  if (headerCells.length === LEDGER_COLUMN_COUNT - 1) {
    headerCells.push(eventIdLabel);
    headerChanged = true;
  } else if (headerCells.length === LEDGER_COLUMN_COUNT && !headerCells[6]) {
    headerCells[6] = eventIdLabel;
    headerChanged = true;
  }

  if (headerChanged) {
    lines[headerIdx] = `| ${headerCells.join(" | ")} |`;
  }

  if (separatorIdx >= 0) {
    const sepCells = parseRow(lines[separatorIdx]!);
    if (sepCells.length < LEDGER_COLUMN_COUNT) {
      while (sepCells.length < LEDGER_COLUMN_COUNT) sepCells.push("--------");
      lines[separatorIdx] = `| ${sepCells.join(" | ")} |`;
    }
  }

  for (const idx of dataIndices) {
    const cells = parseRow(lines[idx]!);
    while (cells.length < LEDGER_COLUMN_COUNT) cells.push("");
    if (!cells[6]) {
      cells[6] = generateAutoEventId(cells);
    }
    lines[idx] = `| ${cells.join(" | ")} |`;
  }

  return lines.join("\n");
}

function generateAutoEventId(cells: ReadonlyArray<string>): string {
  const chapter = (cells[0] ?? "unknown").replace(/\s+/g, "");
  const resource = (cells[1] ?? "unknown").replace(/\s+/g, "");
  const reason = cells[5] ?? "";
  const hash = simpleHash(`${chapter}|${resource}|${reason}`).slice(0, 6);
  return `auto-ch${chapter}-${hash}`;
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h * 31) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
