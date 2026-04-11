import { describe, expect, it } from "vitest";
import { ledgerInitial } from "../utils/ledger-schema.js";
import {
  isHooksSentinel,
  isLedgerSentinel,
  isStateSentinel,
  mergeLedgerForPersistence,
} from "../utils/truth-file-persistence.js";

describe("truth-file-persistence", () => {
  it("recognizes ledger sentinels in both languages", () => {
    expect(isLedgerSentinel("")).toBe(true);
    expect(isLedgerSentinel("(账本未更新)")).toBe(true);
    expect(isLedgerSentinel("(ledger not updated)")).toBe(true);
    expect(isLedgerSentinel("| Chapter | Resource | Opening | Delta | Closing | Reason |")).toBe(false);
  });

  it("recognizes state sentinels in both languages", () => {
    expect(isStateSentinel("")).toBe(true);
    expect(isStateSentinel("(状态卡未更新)")).toBe(true);
    expect(isStateSentinel("(state card not updated)")).toBe(true);
    expect(isStateSentinel("# Current State")).toBe(false);
  });

  it("recognizes hooks sentinels in both languages", () => {
    expect(isHooksSentinel("")).toBe(true);
    expect(isHooksSentinel("(伏笔池未更新)")).toBe(true);
    expect(isHooksSentinel("(hooks pool not updated)")).toBe(true);
    expect(isHooksSentinel("# Pending Hooks")).toBe(false);
  });

  it("returns null when incoming ledger is a sentinel", () => {
    expect(mergeLedgerForPersistence(ledgerInitial("zh"), "(账本未更新)", "zh")).toBeNull();
    expect(mergeLedgerForPersistence(ledgerInitial("en"), "(ledger not updated)", "en")).toBeNull();
  });

  it("falls back to ledgerInitial when current ledger is a sentinel", () => {
    const incoming = [
      "# Resource Ledger",
      "",
      "| Chapter | Resource | Opening | Delta | Closing | Reason |",
      "|---------|----------|---------|-------|---------|--------|",
      "| 1 | Ether | 0 | +3 | 3 | New gain |",
    ].join("\n");

    const merged = mergeLedgerForPersistence("(ledger not updated)", incoming, "en");

    expect(merged).toContain("| 0 | - | 0 | 0 | 0 | Initial book state |");
    expect(merged).toContain("| 1 | Ether | 0 | +3 | 3 | New gain |");
  });

  it("overwrites an existing ledger row when incoming reuses the same 事件ID (reviser rewrite)", () => {
    // When the LLM reviser corrects a previously-written event, it MUST
    // reuse that event's original 事件ID so the merge layer can overwrite
    // instead of accumulating a stale duplicate.
    const current = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |",
      "|------|----------|------|------|------|------|--------|",
      "| 0 | - | 0 | 0 | 0 | 开书初始 | init-0 |",
      "| 1 | 灵石 | 0 | +50 | 50 | 旧记录 | ch1-灵石-1 |",
      "| 1 | 药剂 | 1 | -1 | 0 | 旧消耗 | ch1-药剂-1 |",
    ].join("\n");
    const incoming = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |",
      "|------|----------|------|------|------|------|--------|",
      "| 1 | 灵石 | 0 | +80 | 80 | 修订后补登 | ch1-灵石-1 |",
    ].join("\n");

    const merged = mergeLedgerForPersistence(current, incoming, "zh");

    expect(merged).toContain("开书初始");
    expect(merged).toContain("| 1 | 灵石 | 0 | +80 | 80 | 修订后补登 | ch1-灵石-1 |");
    expect(merged).toContain("| 1 | 药剂 | 1 | -1 | 0 | 旧消耗 | ch1-药剂-1 |");
    // Old version replaced because the new row reused the same 事件ID
    expect(merged).not.toContain("旧记录");
  });

  it("preserves multiple distinct events in the same (章节, 资源名称) when incoming uses distinct 事件IDs", () => {
    // Bug-E scenario: ch4 has 4 legitimate 情报权 events in one chapter.
    // Each event gets a distinct 事件ID (ch4-情报权-1..4), so merge must
    // preserve all four — never collapse them by (章节, 资源名称).
    const current = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |",
      "|------|----------|------|------|------|------|--------|",
      "| 0 | - | 0 | 0 | 0 | 开书初始 | init-0 |",
    ].join("\n");
    const incoming = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |",
      "|------|----------|------|------|------|------|--------|",
      "| 4 | 情报权 | 27 | +1 | 28 | 顾家再次来人 | ch4-情报权-1 |",
      "| 4 | 情报权 | 28 | +1 | 29 | 周巡事查明旧库少失 | ch4-情报权-2 |",
      "| 4 | 情报权 | 29 | +1 | 30 | 旧单缺失意味着内鬼 | ch4-情报权-3 |",
      "| 4 | 情报权 | 30 | +1 | 31 | 徐老从脉象确认外探 | ch4-情报权-4 |",
    ].join("\n");

    const merged = mergeLedgerForPersistence(current, incoming, "zh");

    expect(merged).toContain("开书初始");
    expect(merged).toContain("ch4-情报权-1");
    expect(merged).toContain("ch4-情报权-2");
    expect(merged).toContain("ch4-情报权-3");
    expect(merged).toContain("ch4-情报权-4");
    expect(merged).toContain("顾家再次来人");
    expect(merged).toContain("徐老从脉象确认外探");
  });

  it("auto-generates 事件ID for legacy 6-column rows missing the column (backward compat)", () => {
    // Old books written before the 事件ID column existed should still work:
    // normalizeLedgerMarkdown adds a content-hash-based fallback id so the
    // merge layer can still dedupe truly-identical rows.
    const legacy = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 |",
      "|------|----------|------|------|------|------|",
      "| 1 | 灵石 | 0 | +50 | 50 | 开采所得 |",
    ].join("\n");
    const incoming = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 | 事件ID |",
      "|------|----------|------|------|------|------|--------|",
      "| 2 | 灵石 | 50 | +20 | 70 | 洞府开挖 | ch2-灵石-1 |",
    ].join("\n");

    const merged = mergeLedgerForPersistence(legacy, incoming, "zh");

    // Legacy row survived and got an auto-generated 事件ID starting with "auto-"
    expect(merged).toContain("开采所得");
    expect(merged).toMatch(/auto-ch1-/);
    // New row with explicit 事件ID also preserved
    expect(merged).toContain("ch2-灵石-1");
  });
});
