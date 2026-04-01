const ACTIONABLE_AUDIT_ISSUE_RE = /^\[(critical|warning)\]\s*/i;

export function hasActionableAuditIssues(auditIssues) {
  if (!Array.isArray(auditIssues)) return false;
  return auditIssues.some((issue) => typeof issue === "string" && ACTIONABLE_AUDIT_ISSUE_RE.test(issue));
}
