import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEDGER_HEADER_ZH,
  LEDGER_HEADER_EN,
  LEDGER_COLUMN_COUNT,
  LEDGER_KEY_COLUMNS,
  LEDGER_INITIAL_ZH,
  LEDGER_INITIAL_EN,
  ledgerSchemaInstruction,
  ledgerInitial,
} from "../utils/ledger-schema.js";
import { buildSettlerSystemPrompt } from "../agents/settler-prompts.js";
import { buildWriterSystemPrompt } from "../agents/writer-prompts.js";

const agentsDir = join(__dirname, "..", "agents");
function readAgent(filename: string): string {
  return readFileSync(join(agentsDir, filename), "utf-8");
}

describe("ledger-schema", () => {
  it("ZH header has the correct column count", () => {
    const cols = LEDGER_HEADER_ZH.split("|").filter((c) => c.trim()).length;
    expect(cols).toBe(LEDGER_COLUMN_COUNT);
  });

  it("EN header has the correct column count", () => {
    const cols = LEDGER_HEADER_EN.split("|").filter((c) => c.trim()).length;
    expect(cols).toBe(LEDGER_COLUMN_COUNT);
  });

  it("key columns are within column range", () => {
    for (const col of LEDGER_KEY_COLUMNS) {
      expect(col).toBeLessThan(LEDGER_COLUMN_COUNT);
    }
  });

  it("initial templates contain their respective headers", () => {
    expect(LEDGER_INITIAL_ZH).toContain(LEDGER_HEADER_ZH);
    expect(LEDGER_INITIAL_EN).toContain(LEDGER_HEADER_EN);
  });

  it("ledgerInitial returns correct template for each language", () => {
    expect(ledgerInitial("zh")).toBe(LEDGER_INITIAL_ZH);
    expect(ledgerInitial("en")).toBe(LEDGER_INITIAL_EN);
  });

  it("ledgerSchemaInstruction includes UPDATED_LEDGER tag and header", () => {
    const zh = ledgerSchemaInstruction("zh");
    expect(zh).toContain("=== UPDATED_LEDGER ===");
    expect(zh).toContain(LEDGER_HEADER_ZH);

    const en = ledgerSchemaInstruction("en");
    expect(en).toContain("=== UPDATED_LEDGER ===");
    expect(en).toContain(LEDGER_HEADER_EN);
  });
});

describe("ledger schema integration in prompts", () => {
  const numericalGenre = {
    name: "玄幻", language: "zh" as const, numericalSystem: true,
    chapterTypes: ["主线推进"], powerScaling: true, defaultWordCount: 3000,
    fatigueWords: [] as string[], protagonistLabel: "主角",
  };
  const nonNumericalGenre = {
    ...numericalGenre, numericalSystem: false,
  };
  const book = {
    id: "test", title: "测试书", genre: "xianxia", platform: "qidian",
    chapterWordCount: 3000,
  };

  it("settler system prompt includes UPDATED_LEDGER schema for numerical genres", () => {
    const prompt = buildSettlerSystemPrompt(book as any, numericalGenre as any, null, "zh");
    expect(prompt).toContain("=== UPDATED_LEDGER ===");
    expect(prompt).toContain(LEDGER_HEADER_ZH);
  });

  it("settler system prompt includes UPDATED_LEDGER for non-numerical genres as well", () => {
    const prompt = buildSettlerSystemPrompt(book as any, nonNumericalGenre as any, null, "zh");
    expect(prompt).toContain("=== UPDATED_LEDGER ===");
    expect(prompt).toContain(LEDGER_HEADER_ZH);
  });

  it("settler system prompt uses EN header when language is en", () => {
    const prompt = buildSettlerSystemPrompt(book as any, numericalGenre as any, null, "en");
    expect(prompt).toContain(LEDGER_HEADER_EN);
  });

  it("writer system prompt (full mode) includes ledger schema for numerical genres", () => {
    const prompt = buildWriterSystemPrompt(
      book as any, numericalGenre as any, null, "", "", "", undefined, 1, "full",
      undefined, undefined, "legacy", undefined,
    );
    expect(prompt).toContain("=== UPDATED_LEDGER ===");
    expect(prompt).toContain(LEDGER_HEADER_ZH);
  });

  it("writer system prompt respects language override for ledger schema", () => {
    const prompt = buildWriterSystemPrompt(
      book as any, numericalGenre as any, null, "", "", "", undefined, 1, "full",
      undefined, "en", "legacy", undefined,
    );
    expect(prompt).toContain(LEDGER_HEADER_EN);
  });
});

describe("source files import shared ledger schema", () => {
  // These tests verify that each agent file references the shared ledger-schema
  // module instead of hardcoding its own header strings.

  it("chapter-analyzer.ts imports from ledger-schema", () => {
    const src = readAgent("chapter-analyzer.ts");
    expect(src).toContain('from "../utils/ledger-schema.js"');
    expect(src).toContain("LEDGER_SCHEMA_INSTRUCTION_EN");
    expect(src).toContain("LEDGER_SCHEMA_INSTRUCTION_ZH");
  });

  it("reviser.ts imports from ledger-schema", () => {
    const src = readAgent("reviser.ts");
    expect(src).toContain('from "../utils/ledger-schema.js"');
    expect(src).toContain("ledgerSchemaInstruction");
  });

  it("architect.ts imports from ledger-schema", () => {
    const src = readAgent("architect.ts");
    expect(src).toContain('from "../utils/ledger-schema.js"');
    expect(src).toContain("ledgerInitial");
    // Must NOT contain old hardcoded headers
    expect(src).not.toContain("期初值");
    expect(src).not.toContain("完整度");
    expect(src).not.toContain("Opening Value");
  });

  it("writer.ts uses LEDGER_KEY_COLUMNS instead of hardcoded [0, 2]", () => {
    const src = readAgent("writer.ts");
    expect(src).toContain("LEDGER_KEY_COLUMNS");
    expect(src).not.toMatch(/mergeTableMarkdownByKey\(.*\[0,\s*2\]/);
  });
});
