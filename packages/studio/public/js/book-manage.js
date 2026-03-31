// InkOS Studio — Book Management (write confirm, settings drawer, chapter ops)
import { state } from "./state.js";
import { $, escapeHtml, showToast, requestJson } from "./utils.js";
import { openWritePipeline } from "./pipeline.js";
import { renderDashboard } from "./dashboard.js";
import { buildSidebarTree } from "./sidebar.js";

// ── Write Confirmation Modal ──

let pendingWriteBookId = null;

export function openWriteConfirm(bookId, prefill) {
  pendingWriteBookId = bookId;
  const modal = $("write-confirm-modal");
  if (!modal) return;

  // Find book info
  const book = state.books.find(b => (b.id || b) === bookId);
  const title = book?.title || bookId;

  $("wc-book-title").textContent = title;
  $("wc-chapter-num").textContent = "加载中...";
  $("wc-count").value = String(prefill?.count || 1);
  $("wc-context").value = prefill?.context || "";
  const skipEl = $("wc-skip-normalize");
  if (skipEl) skipEl.checked = false;

  // Fetch book config for default word count, then apply prefill override
  requestJson(`/api/book-config?bookId=${encodeURIComponent(bookId)}`).then(res => {
    if (res.ok && res.config) {
      $("wc-words").value = String(prefill?.words || res.config.chapterWordCount || 3000);
    }
  }).catch(() => {
    if (prefill?.words) $("wc-words").value = String(prefill.words);
  });

  requestJson(`/api/chapters?bookId=${encodeURIComponent(bookId)}`).then(res => {
    const chapters = res.chapters || res.data || [];
    $("wc-chapter-num").textContent = `第 ${chapters.length + 1} 章`;
  }).catch(() => {
    $("wc-chapter-num").textContent = "第 ? 章";
  });

  modal.style.display = "flex";
}

function closeWriteConfirm() {
  const modal = $("write-confirm-modal");
  if (modal) modal.style.display = "none";
  pendingWriteBookId = null;
}

function confirmWrite() {
  if (!pendingWriteBookId) return;
  const bookId = pendingWriteBookId;
  const count = Number($("wc-count")?.value) || 1;
  const words = Number($("wc-words")?.value) || undefined;
  const context = $("wc-context")?.value?.trim() || "";
  const skipLengthNormalization = $("wc-skip-normalize")?.checked || false;

  closeWriteConfirm();
  openWritePipeline(bookId, { autoStart: true, count, words, context, skipLengthNormalization });
}

// ── Book Settings Drawer ──

let settingsBookId = null;

export function openBookSettings(bookId) {
  settingsBookId = bookId;
  const modal = $("book-settings-modal");
  if (!modal) return;

  const book = state.books.find(b => (b.id || b) === bookId);
  $("bs-title").textContent = `书籍设置: ${book?.title || bookId}`;

  // Load config
  requestJson(`/api/book-config?bookId=${encodeURIComponent(bookId)}`).then(res => {
    if (res.ok && res.config) {
      $("bs-words").value = String(res.config.chapterWordCount || 3000);
      $("bs-target").value = String(res.config.targetChapters || 200);
      $("bs-status").value = res.config.status || "active";
      $("bs-lang").value = res.config.language || "zh";
    }
  }).catch(() => {});

  // Load chapters for chapter management
  loadChapterList(bookId);

  // Load foundation file status
  loadFoundationStatus(bookId);

  modal.style.display = "flex";
}

function closeBookSettings() {
  const modal = $("book-settings-modal");
  if (modal) modal.style.display = "none";
  settingsBookId = null;
}

async function loadChapterList(bookId) {
  const container = $("bs-chapter-list");
  if (!container) return;
  container.innerHTML = "加载中...";

  try {
    const res = await requestJson(`/api/chapters?bookId=${encodeURIComponent(bookId)}`);
    const chapters = res.chapters || res.data || [];
    if (chapters.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">暂无章节</div>';
      return;
    }

    const lastNum = Math.max(...chapters.map(c => c.number));
    container.innerHTML = chapters.map(ch => {
      const isLast = ch.number === lastNum;
      return `<div class="bs-chapter-item">
        <span>第${ch.number}章 ${escapeHtml(ch.title || "")}</span>
        <div class="bs-chapter-item-actions">
          <button data-rewrite="${ch.number}" title="重写本章">重写</button>
          ${isLast ? `<button class="btn-danger-sm" data-rollback="${ch.number}" title="撤销本章">撤销</button>` : ""}
        </div>
      </div>`;
    }).join("");

    // Bind chapter action buttons
    container.querySelectorAll("[data-rewrite]").forEach(btn => {
      btn.addEventListener("click", () => confirmRewrite(bookId, Number(btn.dataset.rewrite), chapters));
    });
    container.querySelectorAll("[data-rollback]").forEach(btn => {
      btn.addEventListener("click", () => confirmRollback(bookId, Number(btn.dataset.rollback), chapters));
    });
  } catch {
    container.innerHTML = '<div style="color:var(--text-muted)">加载失败</div>';
  }
}

async function confirmRollback(bookId, chapterNumber, chapters) {
  const ch = chapters.find(c => c.number === chapterNumber);
  const title = ch ? `第${ch.number}章 ${ch.title}` : `第${chapterNumber}章`;
  if (!confirm(`确定撤销 ${title}？\n\n将回退到第 ${chapterNumber - 1} 章的状态。此操作不可撤销。`)) return;

  try {
    const res = await requestJson("/api/chapter-rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, chapterNumber }),
    });
    if (res.ok) {
      showToast(`已撤销到第 ${chapterNumber - 1} 章`);
      loadChapterList(bookId);
      if (state.activeBookId === bookId) await buildSidebarTree(bookId);
    } else {
      showToast(res.error || "撤销失败", "error");
    }
  } catch (e) {
    showToast(String(e.message || e), "error");
  }
}

async function confirmRewrite(bookId, chapterNumber, chapters) {
  const affected = chapters.filter(c => c.number >= chapterNumber);
  const list = affected.map(c => `  第${c.number}章 ${c.title || ""}`).join("\n");
  if (!confirm(`重写第${chapterNumber}章？\n\n以下章节将被删除并重新生成：\n${list}\n\n此操作不可撤销。`)) return;

  closeBookSettings();
  // Rewrite uses the full pipeline rendering via openRewritePipeline
  const { openRewritePipeline } = await import("./pipeline.js");
  openRewritePipeline(bookId, chapterNumber);
}

async function saveBookConfig() {
  if (!settingsBookId) return;
  try {
    const res = await requestJson("/api/book-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: settingsBookId,
        chapterWordCount: Number($("bs-words")?.value),
        targetChapters: Number($("bs-target")?.value),
        status: $("bs-status")?.value,
        language: $("bs-lang")?.value,
      }),
    });
    if (res.ok) {
      showToast("设置已保存");
      // Sync updated config back to frontend state
      const book = state.books.find(b => (b.id || b) === settingsBookId);
      if (book && res.config) {
        book.chapterWordCount = res.config.chapterWordCount;
        book.targetChapters = res.config.targetChapters;
        book.status = res.config.status;
        book.language = res.config.language;
      }
      renderDashboard();
    } else {
      showToast(res.error || "保存失败", "error");
    }
  } catch (e) {
    showToast(String(e.message || e), "error");
  }
}

async function deleteBook() {
  if (!settingsBookId) return;
  const book = state.books.find(b => (b.id || b) === settingsBookId);
  const title = book?.title || settingsBookId;
  if (!confirm(`确定删除 "${title}"？\n\n所有章节和设定数据将被永久删除。此操作不可撤销。`)) return;

  try {
    const res = await requestJson("/api/book", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: settingsBookId }),
    });
    if (res.ok) {
      showToast(`"${title}" 已删除`);
      closeBookSettings();
      // Clear global context if the deleted book was active
      if (state.activeBookId === settingsBookId) {
        state.activeBookId = "";
        state.chatContext = {};
        const sel = document.getElementById("book-select");
        if (sel) sel.value = "";
      }
      // Refresh book list — /api/book-stats returns { ok, data: [...] }
      try {
        const booksRes = await requestJson("/api/book-stats");
        state.books = booksRes.data || booksRes.books || [];
      } catch {}
      renderDashboard();
    } else {
      showToast(res.error || "删除失败", "error");
    }
  } catch (e) {
    showToast(String(e.message || e), "error");
  }
}

// ── Init ──

// ── Foundation Status & Rebuild ──

const FOUNDATION_FILES = [
  { key: "story_bible.md", label: "故事圣经" },
  { key: "volume_outline.md", label: "全书大纲" },
  { key: "book_rules.md", label: "书籍规则" },
];

async function loadFoundationStatus(bookId) {
  const container = $("bs-foundation");
  if (!container) return;
  container.innerHTML = "检查中...";

  try {
    const res = await requestJson(`/api/foundation-status?bookId=${encodeURIComponent(bookId)}`);
    const files = res.files ?? {};
    const hasMissing = FOUNDATION_FILES.some(f => !files[f.key]);

    container.innerHTML = FOUNDATION_FILES.map(f => {
      const exists = !!files[f.key];
      return `<div class="bs-foundation-item">
        <span class="bs-foundation-status ${exists ? "exists" : "missing"}">${exists ? "✓" : "✗"}</span>
        <span>${f.label}</span>
        <span class="bs-foundation-file">${f.key}</span>
      </div>`;
    }).join("");

    // Highlight rebuild button if missing
    const btn = $("bs-rebuild");
    if (btn) {
      btn.classList.toggle("btn-danger", hasMissing);
      btn.classList.toggle("accent", !hasMissing);
    }

    const pipelineStatus = await requestJson("/api/pipeline/status").catch(() => ({ running: false }));
    const hooksBtn = $("bs-rebuild-hooks");
    if (btn) btn.disabled = Boolean(pipelineStatus.running);
    if (hooksBtn) hooksBtn.disabled = Boolean(pipelineStatus.running);
  } catch {
    container.innerHTML = '<span style="color:var(--text-muted)">检查失败</span>';
  }
}

function rebuildFoundation() {
  if (!settingsBookId) return;
  if (!confirm("将从已有章节反推重建 story_bible、volume_outline、book_rules。\n原有文件将被覆盖。是否继续？")) return;

  const bookId = settingsBookId;
  const textarea = $("bs-rebuild-context");
  const externalContext = textarea?.value?.trim() || "";
  const targetChapters = parseInt($("bs-rebuild-chapters")?.value, 10) || 200;
  const chapterWordCount = parseInt($("bs-rebuild-words")?.value, 10) || 3000;

  closeBookSettings();
  document.dispatchEvent(new CustomEvent("inkos:open-rebuild-pipeline", {
    detail: { bookId, externalContext, targetChapters, chapterWordCount },
  }));
}

function rebuildHooks() {
  if (!settingsBookId) return;
  if (!confirm("将根据已有章节逐章重建伏笔钩子。\npending_hooks、hooks.json 和 memory.db hooks 将被覆盖。是否继续？")) return;

  const bookId = settingsBookId;
  closeBookSettings();
  document.dispatchEvent(new CustomEvent("inkos:open-rebuild-hooks-pipeline", {
    detail: { bookId },
  }));
}

export function initBookManage() {
  // Write confirm modal
  $("write-confirm-close")?.addEventListener("click", closeWriteConfirm);
  $("write-confirm-cancel")?.addEventListener("click", closeWriteConfirm);
  $("write-confirm-ok")?.addEventListener("click", confirmWrite);

  // Book settings drawer
  $("book-settings-close")?.addEventListener("click", closeBookSettings);
  $("bs-save")?.addEventListener("click", saveBookConfig);
  $("bs-delete")?.addEventListener("click", deleteBook);
  $("bs-rebuild")?.addEventListener("click", rebuildFoundation);
  $("bs-rebuild-hooks")?.addEventListener("click", rebuildHooks);

  // Click backdrop to close
  $("write-confirm-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "write-confirm-modal") closeWriteConfirm();
  });
  $("book-settings-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "book-settings-modal") closeBookSettings();
  });

  // Expose for dashboard gear button
  window.openBookSettings = openBookSettings;
}
