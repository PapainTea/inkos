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

  it("merges partial ledgers by key while preserving unrelated history", () => {
    const current = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 |",
      "|------|----------|------|------|------|------|",
      "| 0 | - | 0 | 0 | 0 | 开书初始 |",
      "| 1 | 灵石 | 0 | +50 | 50 | 旧记录 |",
      "| 1 | 药剂 | 1 | -1 | 0 | 旧消耗 |",
    ].join("\n");
    const incoming = [
      "# 资源账本",
      "",
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 |",
      "|------|----------|------|------|------|------|",
      "| 1 | 灵石 | 0 | +80 | 80 | 修订后补登 |",
    ].join("\n");

    const merged = mergeLedgerForPersistence(current, incoming, "zh");

    expect(merged).toContain("| 0 | - | 0 | 0 | 0 | 开书初始 |");
    expect(merged).toContain("| 1 | 灵石 | 0 | +80 | 80 | 修订后补登 |");
    expect(merged).toContain("| 1 | 药剂 | 1 | -1 | 0 | 旧消耗 |");
    expect(merged).not.toContain("| 1 | 灵石 | 0 | +50 | 50 | 旧记录 |");
  });

  it("preserves schema-mismatch behavior from mergeTableMarkdownByKey", () => {
    const current = [
      "| 资源类型 | 资源项 | 期初 | 增量 | 消耗 | 期末 |",
      "|----------|--------|------|------|------|------|",
      "| 灵石 | 灵石储量 | 0 | +50 | 0 | 50 |",
    ].join("\n");
    const incoming = [
      "| 章节 | 资源名称 | 期初 | 变动 | 期末 | 事由 |",
      "|------|----------|------|------|------|------|",
      "| 1 | 灵力 | 0 | +100 | 100 | 吞噬果实 |",
    ].join("\n");

    expect(mergeLedgerForPersistence(current, incoming, "zh")).toBe(incoming);
  });
});
