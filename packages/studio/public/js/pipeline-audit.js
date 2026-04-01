const AUDITOR_STAGE_IDS = new Set(["auditor", "audit", "reaudit"]);

const SEVERITY_LABELS = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

const PIPELINE_STAGE_LABELS = {
  config: "保存书籍配置",
  architect: "Architect 生成基础设定",
  control: "初始化控制文档",
  snapshot: "创建初始快照",
  input: "准备章节输入",
  planner: "Planner 规划章节意图",
  composer: "Composer 组装上下文",
  writer: "Writer 执笔创作",
  normalizer: "Normalizer 字数归一化",
  auditor: "Auditor 审计",
  audit: "Auditor 审计",
  "load-audit": "读取现有审计文件",
  reviser: "Reviser 修订",
  reaudit: "Auditor 重新审计",
  settler: "Settler 状态结算",
  validator: "Validator 校验真相文件",
  persist: "落盘章节",
  memory: "同步记忆索引",
};

function normalizeIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues
    .filter((issue) => issue && typeof issue.description === "string")
    .map((issue) => ({
      severity: issue.severity ?? "info",
      category: issue.category ?? "",
      description: issue.description,
      suggestion: issue.suggestion ?? "",
    }));
}

function normalizeAuditResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    passed: Boolean(result.passed),
    summary: typeof result.summary === "string" ? result.summary : "",
    issues: normalizeIssues(result.issues),
  };
}

function extractWriteLikeResult(payload) {
  if (!payload || typeof payload !== "object") return null;

  if (payload.auditResult && typeof payload.auditResult === "object") {
    return payload;
  }

  if (Array.isArray(payload)) {
    const last = payload.at(-1);
    return extractWriteLikeResult(last);
  }

  if (Array.isArray(payload.data)) {
    return extractWriteLikeResult(payload.data);
  }

  if (payload.data?.auditResult && typeof payload.data.auditResult === "object") {
    return payload.data;
  }

  if (Array.isArray(payload.data?.chapters)) {
    const last = payload.data.chapters.at(-1);
    return extractWriteLikeResult(last);
  }

  if (payload.result) {
    return extractWriteLikeResult(payload.result);
  }

  if (payload.write) {
    return extractWriteLikeResult(payload.write);
  }

  if (payload.data?.firstChapter) {
    return extractWriteLikeResult(payload.data.firstChapter);
  }

  return null;
}

export function isAuditorStageId(stageId) {
  return typeof stageId === "string" && AUDITOR_STAGE_IDS.has(stageId);
}

export function resolvePipelineStageLabel(stageId) {
  return PIPELINE_STAGE_LABELS[stageId] || stageId;
}

export function chooseOverlayDisplayStageId(activeStageId, stages, currentDisplayStageId = null) {
  if (isAuditorStageId(activeStageId)) return activeStageId;

  if (isAuditorStageId(currentDisplayStageId)) {
    const currentStage = (stages ?? []).find((stage) => stage?.id === currentDisplayStageId);
    if (Number(currentStage?.displayLength ?? 0) > 0) {
      return currentDisplayStageId;
    }
  }

  let bestId = activeStageId ?? null;
  let bestLen = -1;

  for (const stage of stages ?? []) {
    const length = Math.max(
      Number(stage?.contentLength ?? 0),
      Number(stage?.displayLength ?? 0),
    );
    if (length > bestLen) {
      bestLen = length;
      bestId = stage?.id ?? null;
    }
  }

  return bestId;
}

export function formatAuditStageMarkdown(result) {
  const audit = normalizeAuditResult(result);
  if (!audit) return "";

  const lines = [];
  lines.push("## 审计结论");
  lines.push(audit.summary || (audit.passed ? "审计通过，无问题。" : "审计完成。"));

  if (audit.issues.length === 0) {
    lines.push("");
    lines.push(audit.passed ? "审计通过，无问题。" : "未返回结构化问题。");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("## 问题列表");

  for (const issue of audit.issues) {
    const sevLabel = SEVERITY_LABELS[issue.severity] ?? issue.severity;
    const categoryPrefix = issue.category ? `${issue.category}：` : "";
    lines.push(`- [${sevLabel}] ${categoryPrefix}${issue.description}`);
    if (issue.suggestion) {
      lines.push(`  建议：${issue.suggestion}`);
    }
  }

  return lines.join("\n");
}

export function extractAuditorStageResults(kind, response) {
  if (!response || typeof response !== "object") return {};

  if (kind === "spotfix") {
    const postAudit = normalizeAuditResult(response.data?.postAudit);
    return {
      ...(postAudit ? { reaudit: postAudit } : {}),
    };
  }

  if (kind === "reaudit") {
    const audit = normalizeAuditResult(response.data);
    return audit ? { audit } : {};
  }

  if (kind === "create" || kind === "write" || kind === "rewrite") {
    const writeLike = extractWriteLikeResult(response);
    const audit = normalizeAuditResult(writeLike?.auditResult);
    return audit ? { auditor: audit } : {};
  }

  return {};
}
