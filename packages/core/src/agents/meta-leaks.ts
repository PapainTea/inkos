/**
 * Meta-information leak detection — pure rule-based analysis (no LLM).
 *
 * Detects patterns that break reader immersion:
 * - Chapter meta-references ("第X章提到过", "上章说过")
 * - Hook ID leaks (H001, H002 etc.)
 * - System tag leaks (=== UPDATED_LEDGER === etc.)
 * - JSON field name leaks (hookOps, currentStatePatch etc.)
 */

export interface MetaLeakIssue {
  readonly severity: "critical" | "warning";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface MetaLeakResult {
  readonly issues: ReadonlyArray<MetaLeakIssue>;
}

// ── Chinese punctuation set for boundary matching (no \b in Chinese) ──

const CJK_BOUNDARY = /[\s，。！？、；：""''（）\[\]【】《》·…—\-\r\n]/;

// ── Detection patterns ──

/** Explicit chapter references: 第X章 (not in book titles or headings) */
const EXPLICIT_CHAPTER_REF = /第[一二三四五六七八九十百千万\d]+章/g;

/** Implicit chapter references: 上章/前几章 + verb */
const IMPLICIT_CHAPTER_REF = /(?:上|前|后)几?章(?:提到|说过|出现|描述|讲过|写过|说的|提过)/g;

/** System tags: === UPPERCASE_TAG === */
const SYSTEM_TAG = /===\s*[A-Z_]+\s*===/g;

/** JSON field names from internal data structures */
const JSON_FIELDS = /\b(?:hookOps|hook_id|startChapter|expectedPayoff|currentStatePatch|chapterSummary|runtimeStateDelta|subplotOps|emotionalArcOps|characterMatrixOps|lastAdvancedChapter|currentLocation|protagonistState|currentGoal|currentConstraint|currentAlliances|currentConflict)\b/gi;

/**
 * Analyze text content for meta-information leaks.
 * Returns issues that can be merged into audit results.
 */
export function analyzeMetaLeaks(content: string): MetaLeakResult {
  const issues: MetaLeakIssue[] = [];
  const lines = content.split("\n");

  // ── a) Chapter meta-references (warning) ──
  detectExplicitChapterRefs(content, lines, issues);
  detectImplicitChapterRefs(content, issues);

  // ── b) Hook ID leaks (critical) ──
  detectHookIdLeaks(content, issues);

  // ── c) System tag leaks (critical) ──
  detectSystemTagLeaks(content, issues);

  // ── d) JSON field name leaks (critical) ──
  detectJsonFieldLeaks(content, issues);

  return { issues };
}

// ── Detection implementations ──

function detectExplicitChapterRefs(
  content: string,
  lines: string[],
  issues: MetaLeakIssue[],
): void {
  // Build set of heading line offsets to exclude title lines like "# 第三章 标题"
  const headingLineStarts = new Set<number>();
  let offset = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith("#")) {
      // Mark all char positions in this line as heading
      for (let i = 0; i < line.length; i++) {
        headingLineStarts.add(offset + i);
      }
    }
    offset += line.length + 1; // +1 for \n
  }

  for (const match of content.matchAll(EXPLICIT_CHAPTER_REF)) {
    const idx = match.index!;

    // Skip heading lines (e.g. "# 第三章 山雨欲来")
    if (headingLineStarts.has(idx)) continue;

    // Skip book-within-book: check if 》 appears within 10 chars before match
    const lookback = content.slice(Math.max(0, idx - 10), idx);
    if (lookback.includes("》")) continue;

    // Skip if preceded by 《 within 20 chars (book title wrapping the reference)
    const widerLookback = content.slice(Math.max(0, idx - 20), idx);
    if (widerLookback.includes("《") && !widerLookback.includes("》")) continue;

    issues.push({
      severity: "warning",
      category: "meta-reference",
      description: `正文中出现章节元引用「${match[0]}」，可能破坏读者沉浸感`,
      suggestion: "如果是角色讨论书中书内容则可忽略，否则改为具体情节描述替代章节号引用",
    });
  }
}

function detectImplicitChapterRefs(
  content: string,
  issues: MetaLeakIssue[],
): void {
  for (const match of content.matchAll(IMPLICIT_CHAPTER_REF)) {
    issues.push({
      severity: "warning",
      category: "meta-reference",
      description: `正文中出现隐式章节引用「${match[0]}」，可能破坏读者沉浸感`,
      suggestion: "改为具体情节回忆或时间描述，避免引用章节概念",
    });
  }
}

function detectHookIdLeaks(
  content: string,
  issues: MetaLeakIssue[],
): void {
  // Match H + 3 or more digits, bounded by CJK punctuation/whitespace/line boundaries
  const hookPattern = /(?:^|(?<=[\s，。！？、；：""''（）\[\]【】《》·…—\-]))H\d{3,}(?=$|[\s，。！？、；：""''（）\[\]【】《》·…—\-])/gm;

  for (const match of content.matchAll(hookPattern)) {
    issues.push({
      severity: "critical",
      category: "system-id-leak",
      description: `正文中出现系统钩子标识符「${match[0]}」，这是内部数据结构泄露`,
      suggestion: "删除钩子 ID，改用具体情节描述",
    });
  }
}

function detectSystemTagLeaks(
  content: string,
  issues: MetaLeakIssue[],
): void {
  for (const match of content.matchAll(SYSTEM_TAG)) {
    issues.push({
      severity: "critical",
      category: "system-tag-leak",
      description: `正文中出现系统标签「${match[0]}」，这是 LLM 输出格式残留`,
      suggestion: "删除系统标签，这些内容不应出现在正文中",
    });
  }
}

function detectJsonFieldLeaks(
  content: string,
  issues: MetaLeakIssue[],
): void {
  for (const match of content.matchAll(JSON_FIELDS)) {
    issues.push({
      severity: "critical",
      category: "system-id-leak",
      description: `正文中出现内部字段名「${match[0]}」，这是数据结构泄露`,
      suggestion: "删除内部字段名，改用自然语言描述",
    });
  }
}
