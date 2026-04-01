import { describe, expect, it } from "vitest";
import { analyzeMetaLeaks } from "../agents/meta-leaks.js";

describe("analyzeMetaLeaks", () => {
  // ── Chapter meta-references (warning) ──

  describe("explicit chapter references", () => {
    it("detects '第三章' in prose as meta-reference", () => {
      const result = analyzeMetaLeaks("他回忆起第三章的内容，那时候一切都不同。");
      const refs = result.issues.filter((i) => i.category === "meta-reference");
      expect(refs.length).toBe(1);
      expect(refs[0]!.severity).toBe("warning");
      expect(refs[0]!.description).toContain("第三章");
    });

    it("detects numeric chapter references like '第3章'", () => {
      const result = analyzeMetaLeaks("正如第3章所述，他已经离开了。");
      expect(result.issues.some((i) => i.category === "meta-reference")).toBe(true);
    });

    it("does NOT flag book-within-book references preceded by 》", () => {
      const result = analyzeMetaLeaks("《九阳真经》第三章记载着一种奇特的功法。");
      const refs = result.issues.filter((i) => i.category === "meta-reference");
      expect(refs.length).toBe(0);
    });

    it("does NOT flag book title wrapping the reference with 《", () => {
      const result = analyzeMetaLeaks("他翻开《剑谱》，翻到第五章，仔细研读。");
      const refs = result.issues.filter((i) => i.category === "meta-reference");
      expect(refs.length).toBe(0);
    });

    it("does NOT flag heading lines", () => {
      const result = analyzeMetaLeaks("# 第三章 山雨欲来\n\n正文内容在这里。");
      const refs = result.issues.filter((i) => i.category === "meta-reference");
      expect(refs.length).toBe(0);
    });

    it("does NOT flag '第三层' or '第三重' (not 章)", () => {
      const result = analyzeMetaLeaks("他突破了第三层境界，修为大涨。");
      const refs = result.issues.filter((i) => i.category === "meta-reference");
      expect(refs.length).toBe(0);
    });
  });

  describe("implicit chapter references", () => {
    it("detects '上章提到'", () => {
      const result = analyzeMetaLeaks("上章提到的那个人，终于出现了。");
      const refs = result.issues.filter((i) => i.category === "meta-reference");
      expect(refs.length).toBe(1);
      expect(refs[0]!.severity).toBe("warning");
    });

    it("detects '前几章说过'", () => {
      const result = analyzeMetaLeaks("前几章说过的秘密武器终于派上了用场。");
      expect(result.issues.some((i) => i.category === "meta-reference")).toBe(true);
    });

    it("detects '后章描述'", () => {
      const result = analyzeMetaLeaks("后章描述的事件在此时埋下了伏笔。");
      expect(result.issues.some((i) => i.category === "meta-reference")).toBe(true);
    });
  });

  // ── Hook ID leaks (critical) ──

  describe("hook ID leaks", () => {
    it("detects H001 as system ID leak", () => {
      const result = analyzeMetaLeaks("H001 已回收，伏笔完成。");
      const leaks = result.issues.filter((i) => i.category === "system-id-leak");
      expect(leaks.length).toBe(1);
      expect(leaks[0]!.severity).toBe("critical");
      expect(leaks[0]!.description).toContain("H001");
    });

    it("detects H001 surrounded by Chinese punctuation", () => {
      const result = analyzeMetaLeaks("（H001）这个伏笔已经回收了。");
      const leaks = result.issues.filter((i) => i.category === "system-id-leak");
      expect(leaks.length).toBe(1);
    });

    it("does NOT flag H2O or short patterns", () => {
      // H + less than 3 digits should not match
      const result = analyzeMetaLeaks("H2O是水的化学式。H12也不应匹配。");
      const leaks = result.issues.filter((i) => i.category === "system-id-leak");
      expect(leaks.length).toBe(0);
    });

    it("does NOT flag H followed by digits embedded in a word", () => {
      // "在H301房间" — H301 preceded by Chinese char, should not match per boundary rules
      const result = analyzeMetaLeaks("在H301房间等候。");
      const leaks = result.issues.filter((i) => i.category === "system-id-leak");
      expect(leaks.length).toBe(0);
    });
  });

  // ── System tag leaks (critical) ──

  describe("system tag leaks", () => {
    it("detects === UPDATED_LEDGER ===", () => {
      const result = analyzeMetaLeaks("一些正文\n=== UPDATED_LEDGER ===\n更多内容");
      const leaks = result.issues.filter((i) => i.category === "system-tag-leak");
      expect(leaks.length).toBe(1);
      expect(leaks[0]!.severity).toBe("critical");
    });

    it("detects any === UPPERCASE_TAG === pattern", () => {
      const result = analyzeMetaLeaks("=== CUSTOM_TAG ===");
      expect(result.issues.some((i) => i.category === "system-tag-leak")).toBe(true);
    });

    it("does NOT flag lowercase or mixed case tags", () => {
      const result = analyzeMetaLeaks("=== some text ===");
      const leaks = result.issues.filter((i) => i.category === "system-tag-leak");
      expect(leaks.length).toBe(0);
    });

    it("does NOT flag scene separators like ===", () => {
      const result = analyzeMetaLeaks("===\n新的场景开始了。");
      const leaks = result.issues.filter((i) => i.category === "system-tag-leak");
      expect(leaks.length).toBe(0);
    });
  });

  // ── JSON field name leaks (critical) ──

  describe("JSON field name leaks", () => {
    it("detects hookOps", () => {
      const result = analyzeMetaLeaks("接下来处理 hookOps 的变更。");
      const leaks = result.issues.filter((i) => i.category === "system-id-leak");
      expect(leaks.some((i) => i.description.includes("hookOps"))).toBe(true);
      expect(leaks[0]!.severity).toBe("critical");
    });

    it("detects currentStatePatch", () => {
      const result = analyzeMetaLeaks("更新 currentStatePatch 中的位置信息。");
      expect(result.issues.some((i) => i.description.includes("currentStatePatch"))).toBe(true);
    });

    it("detects runtimeStateDelta", () => {
      const result = analyzeMetaLeaks("输出 runtimeStateDelta JSON 格式。");
      expect(result.issues.some((i) => i.description.includes("runtimeStateDelta"))).toBe(true);
    });
  });

  // ── Combined scenarios ──

  describe("combined", () => {
    it("detects multiple types of leaks in the same content", () => {
      const content = [
        "# 第五章 暗流涌动",
        "",
        "他回忆起第三章的内容，当时H001已经埋下。",
        "",
        "=== UPDATED_STATE ===",
        "",
        "hookOps 需要更新。",
      ].join("\n");

      const result = analyzeMetaLeaks(content);
      const categories = new Set(result.issues.map((i) => i.category));
      expect(categories.has("meta-reference")).toBe(true);
      expect(categories.has("system-id-leak")).toBe(true);
      expect(categories.has("system-tag-leak")).toBe(true);
    });

    it("returns empty issues for clean content", () => {
      const content = "他站在山巅，望着远处的落日，心中百感交集。风从背后吹来，带着松林的清香。";
      const result = analyzeMetaLeaks(content);
      expect(result.issues.length).toBe(0);
    });
  });
});
