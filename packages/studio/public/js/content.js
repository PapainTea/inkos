// InkOS Studio — Content View
import { state } from "./state.js";
import { $, escapeHtml, requestJson, runAction, showToast } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { setView } from "./views.js";
import { STORY_FILES } from "./sidebar.js";

export async function showContent(type, bookId, file) {
  state.contentState = { type, bookId, file, content: "", isEditing: false };
  setView("content");

  $("content-body").innerHTML = '<div class="sidebar-empty">加载中...</div>';
  $("content-editor").style.display = "none";
  $("content-body").style.display = "block";
  $("save-content").style.display = "none";
  $("toggle-edit").textContent = "编辑";
  $("audit-panel").style.display = "none";

  const labels = {
    "volume_outline.md": "全书大纲",
    "story_bible.md": "故事圣经",
    "book_rules.md": "书籍规则",
    "current_state.md": "当前状态",
    "particle_ledger.md": "资源账本",
    "pending_hooks.md": "伏笔钩子",
    "chapter_summaries.md": "章节摘要",
    "subplot_board.md": "支线进度",
    "emotional_arcs.md": "情感弧线",
    "character_matrix.md": "角色矩阵",
  };
  const fileLabel = labels[file] || file;
  const groupLabel = type === "chapter" ? "章节" : (STORY_FILES.some(s => s.file === file) ? "大纲" : "世界状态");
  $("content-breadcrumb").innerHTML = `${escapeHtml(bookId)} &rsaquo; ${escapeHtml(groupLabel)} &rsaquo; <span>${escapeHtml(fileLabel)}</span>`;

  state.chatContext = {
    targetType: type === "chapter" ? "chapter" : (file === "volume_outline.md" ? "outline" : "brief"),
    bookId,
    file,
  };

  await runAction("加载文件...", async () => {
    let content = "";
    if (type === "chapter") {
      const res = await requestJson(`/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    } else if (type === "story-file") {
      const res = await requestJson(`/api/story-file?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    }
    state.contentState.content = content;
    $("content-body").innerHTML = renderMarkdown(content);
  });

  // Render audit panel for chapters
  if (type === "chapter") {
    renderAuditPanel(bookId, file);
  }
}

export function toggleEdit() {
  const cs = state.contentState;
  cs.isEditing = !cs.isEditing;

  if (cs.isEditing) {
    $("content-body").style.display = "none";
    $("content-editor").style.display = "block";
    $("content-editor").value = cs.content;
    $("save-content").style.display = "";
    $("toggle-edit").textContent = "预览";
    $("content-editor").focus();
  } else {
    const edited = $("content-editor").value;
    cs.content = edited;
    $("content-body").style.display = "block";
    $("content-editor").style.display = "none";
    $("content-body").innerHTML = renderMarkdown(edited);
    $("save-content").style.display = "none";
    $("toggle-edit").textContent = "编辑";
  }
}

export async function saveContent() {
  const cs = state.contentState;
  const content = $("content-editor").value;
  cs.content = content;

  await runAction("保存中...", async () => {
    if (cs.type === "chapter") {
      await requestJson(`/api/chapter?bookId=${encodeURIComponent(cs.bookId)}&file=${encodeURIComponent(cs.file)}`, {
        method: "PUT", body: JSON.stringify({ content }),
      });
    } else if (cs.type === "story-file") {
      await requestJson(`/api/story-file?bookId=${encodeURIComponent(cs.bookId)}&file=${encodeURIComponent(cs.file)}`, {
        method: "PUT", body: JSON.stringify({ content }),
      });
    }
    showToast("已保存");
  });
}

export function backToChat() {
  setView("chat");
  $("sidebar-tree").querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
}

// ── Audit detail panel ──

function findChapterMeta(file) {
  if (!state.chapterIndex) return null;
  // Extract chapter number from filename like "0001_title.md"
  const numMatch = file.match(/^(\d+)/);
  if (!numMatch) return null;
  const chapterNum = parseInt(numMatch[1], 10);
  return state.chapterIndex.find((ch) => ch.number === chapterNum) ?? null;
}

function parseIssueSeverity(issue) {
  const match = issue.match(/^\[(critical|warning|info)\]\s*/);
  if (!match) return { severity: "info", text: issue };
  return { severity: match[1], text: issue.slice(match[0].length) };
}

const SEVERITY_LABELS = { critical: "严重", warning: "警告", info: "提示" };

function renderAuditPanel(bookId, file) {
  const panel = $("audit-panel");
  const meta = findChapterMeta(file);
  if (!meta) { panel.style.display = "none"; return; }

  const issues = meta.auditIssues ?? [];
  const warnings = meta.lengthWarnings ?? [];
  const reviewNote = meta.reviewNote ?? "";
  const status = meta.status;
  const hasIssues = issues.length > 0 || warnings.length > 0;

  let html = `<details class="audit-details" ${hasIssues ? "open" : ""}>
    <summary class="audit-summary">
      <span class="audit-summary-title">审计详情</span>
      <span class="audit-summary-count">${issues.length > 0 ? issues.length + " 项" : "无问题"}</span>
    </summary>
    <div class="audit-content">`;

  if (reviewNote) {
    html += `<div class="audit-review-note">
      <span class="audit-review-note-label">人工审核备注：</span>${escapeHtml(reviewNote)}
    </div>`;
  }

  if (issues.length === 0 && warnings.length === 0) {
    html += `<div class="audit-empty">审计通过，无问题。</div>`;
  } else {
    if (issues.length > 0) {
      html += `<ul class="audit-issue-list">`;
      for (const raw of issues) {
        const { severity, text } = parseIssueSeverity(raw);
        html += `<li class="audit-issue audit-${severity}">
          <span class="audit-severity-badge">${SEVERITY_LABELS[severity] ?? severity}</span>
          <span class="audit-issue-text">${escapeHtml(text)}</span>
        </li>`;
      }
      html += `</ul>`;
    }
    if (warnings.length > 0) {
      html += `<div class="audit-length-warnings">
        <div class="audit-section-label">字数警告</div>
        <ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      </div>`;
    }
  }

  // Action buttons (功能 2 & 3 will be added here later)
  const isAuditFailed = status === "audit-failed" || status === "rejected";
  if (isAuditFailed) {
    html += `<div class="audit-actions">
      <button class="btn ghost audit-btn-approve" id="audit-approve-btn" type="button">手动通过</button>
      <button class="btn accent audit-btn-spotfix" id="audit-spotfix-btn" type="button">针对性修订</button>
    </div>`;
  }

  html += `</div></details>`;
  panel.innerHTML = html;
  panel.style.display = "";

  // Bind action buttons
  if (isAuditFailed) {
    $("audit-approve-btn")?.addEventListener("click", () => handleApprove(bookId, meta.number));
    $("audit-spotfix-btn")?.addEventListener("click", () => handleSpotfix(bookId, meta.number));
  }
}

// ── 功能 3: Manual approve ──

async function handleApprove(bookId, chapterNumber) {
  const note = prompt("（可选）请输入手动通过的原因：");
  if (note === null) return; // cancelled

  await runAction("提交审核...", async () => {
    const res = await requestJson("/api/chapter-approve", {
      method: "POST",
      body: JSON.stringify({ bookId, chapterNumber, reviewNote: note || undefined }),
    });
    if (res.ok) {
      showToast("已手动通过");
      // Refresh sidebar and audit panel
      const { buildSidebarTree } = await import("./sidebar.js");
      await buildSidebarTree(bookId);
      renderAuditPanel(bookId, state.contentState.file);
    } else {
      showToast(res.error || "操作失败", "error");
    }
  });
}

// ── 功能 2: Spot-fix (placeholder — will be implemented with SSE) ──

async function handleSpotfix(bookId, chapterNumber) {
  const btn = $("audit-spotfix-btn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "正在审计...";

  try {
    const res = await fetch("/api/chapter-spotfix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, chapterNumber }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      showToast(errBody.error || "修订请求失败", "error");
      btn.disabled = false;
      btn.textContent = "针对性修订";
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data);
          if (evt.stage) btn.textContent = evt.stage;
          if (evt.error) showToast(evt.error, "error");
          if (evt.result) {
            showToast(evt.result.passed ? "修订完成，审计通过" : "修订完成，仍有问题待处理");
          }
        } catch {}
      }
    }

    // Refresh after SSE completes — showContent re-renders everything including audit panel
    await showContent("chapter", bookId, state.contentState.file);
    const { buildSidebarTree } = await import("./sidebar.js");
    await buildSidebarTree(bookId);
  } catch (e) {
    showToast("修订出错: " + String(e), "error");
    // Try to restore button if it still exists
    const restoreBtn = $("audit-spotfix-btn");
    if (restoreBtn) {
      restoreBtn.disabled = false;
      restoreBtn.textContent = "针对性修订";
    }
  }
}
