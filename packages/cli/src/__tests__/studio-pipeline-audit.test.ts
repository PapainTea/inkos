import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("studio pipeline auditor helpers", () => {
  it("recognizes all auditor-like stage ids", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { isAuditorStageId } = await import(helperModulePath);

    expect(isAuditorStageId("auditor")).toBe(true);
    expect(isAuditorStageId("audit")).toBe(true);
    expect(isAuditorStageId("reaudit")).toBe(true);
    expect(isAuditorStageId("load-audit")).toBe(false);
    expect(isAuditorStageId("writer")).toBe(false);
    expect(isAuditorStageId("reviser")).toBe(false);
  });

  it("prefers the active auditor stage in the overlay over the content-heaviest stage", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { chooseOverlayDisplayStageId } = await import(helperModulePath);

    const displayId = chooseOverlayDisplayStageId("audit", [
      { id: "writer", contentLength: 8000 },
      { id: "audit", contentLength: 120 },
      { id: "reviser", contentLength: 0 },
    ]);

    expect(displayId).toBe("audit");
  });

  it("falls back to the content-heaviest stage when the active stage is not auditor-related", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { chooseOverlayDisplayStageId } = await import(helperModulePath);

    const displayId = chooseOverlayDisplayStageId("reviser", [
      { id: "writer", contentLength: 8000 },
      { id: "audit", contentLength: 120 },
      { id: "reviser", contentLength: 10 },
    ]);

    expect(displayId).toBe("writer");
  });

  it("keeps the last structured auditor result visible after auditor stops being active", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { chooseOverlayDisplayStageId } = await import(helperModulePath);

    const displayId = chooseOverlayDisplayStageId("reviser", [
      { id: "writer", contentLength: 8000, displayLength: 0 },
      { id: "audit", contentLength: 120, displayLength: 260 },
      { id: "reviser", contentLength: 48, displayLength: 0 },
    ], "audit");

    expect(displayId).toBe("audit");
  });

  it("resolves human-readable labels for audit and reaudit stages", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { resolvePipelineStageLabel } = await import(helperModulePath);

    expect(resolvePipelineStageLabel("audit")).toBe("Auditor 审计");
    expect(resolvePipelineStageLabel("reaudit")).toBe("Auditor 重新审计");
    expect(resolvePipelineStageLabel("writer")).toBe("Writer 执笔创作");
  });

  it("formats structured audit results into readable markdown", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { formatAuditStageMarkdown } = await import(helperModulePath);

    const markdown = formatAuditStageMarkdown({
      passed: false,
      summary: "存在连续性和节奏问题",
      issues: [
        {
          severity: "critical",
          category: "连续性",
          description: "角色位置与上一章冲突",
          suggestion: "统一角色站位并补足过渡",
        },
        {
          severity: "warning",
          category: "节奏",
          description: "中段推进过慢",
          suggestion: "压缩重复动作描写",
        },
      ],
    });

    expect(markdown).toContain("## 审计结论");
    expect(markdown).toContain("存在连续性和节奏问题");
    expect(markdown).toContain("- [严重] 连续性：角色位置与上一章冲突");
    expect(markdown).toContain("- [警告] 节奏：中段推进过慢");
    expect(markdown).toContain("建议：统一角色站位并补足过渡");
  });

  it("extracts auditor stage results from write-like pipeline responses", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { extractAuditorStageResults } = await import(helperModulePath);

    const results = extractAuditorStageResults("write", {
      ok: true,
      data: [
        {
          chapterNumber: 3,
          auditResult: {
            passed: false,
            summary: "存在 2 项问题",
            issues: [
              { severity: "warning", category: "节奏", description: "铺垫略长", suggestion: "压缩重复段落" },
            ],
          },
        },
      ],
    });

    expect(results).toEqual({
      auditor: {
        passed: false,
        summary: "存在 2 项问题",
        issues: [
          { severity: "warning", category: "节奏", description: "铺垫略长", suggestion: "压缩重复段落" },
        ],
      },
    });
  });

  it("extracts only the visible re-audit result from spotfix responses", async () => {
    const helperModulePath = "../../../studio/public/js/pipeline-audit.js";
    const { extractAuditorStageResults } = await import(helperModulePath);

    const results = extractAuditorStageResults("spotfix", {
      ok: true,
      data: {
        preAudit: {
          passed: false,
          summary: "修订前存在问题",
          issues: [
            { severity: "critical", category: "连续性", description: "时间线冲突", suggestion: "统一时间点" },
          ],
        },
        postAudit: {
          passed: true,
          summary: "修订后审计通过",
          issues: [],
        },
      },
    });

    expect(results).toEqual({
      reaudit: {
        passed: true,
        summary: "修订后审计通过",
        issues: [],
      },
    });
  });

  it("keeps spotfix stage contracts aligned between pipeline.js and server.cjs", () => {
    const pipelinePath = fileURLToPath(new URL("../../../studio/public/js/pipeline.js", import.meta.url));
    const serverPath = fileURLToPath(new URL("../../../studio/server.cjs", import.meta.url));
    const pipelineSource = readFileSync(pipelinePath, "utf8");
    const serverSource = readFileSync(serverPath, "utf8");

    expect(pipelineSource).toContain('const SPOTFIX_STAGES = ["load-audit", "reviser", "reaudit", "settler"];');
    expect(pipelineSource).toContain('"load-audit": "读取现有审计文件"');
    expect(pipelineSource).toContain('settler: "Settler 状态结算"');

    expect(serverSource).toContain('createPipelineTask("spotfix", bookId, ["load-audit", "reviser", "reaudit", "settler"])');
    expect(serverSource).toContain('"load-audit": "正在读取现有审计文件"');
    expect(serverSource).toContain('settler: "状态结算"');
  });
});
