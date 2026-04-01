// InkOS Studio — Editor (Three-Column Layout)
import { state } from "./state.js";
import { $, escapeHtml, requestJson, fetchSSE, runAction, showToast, autoResizeInput } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { setView, setEditorTabEnabled } from "./views.js";
import { STORY_FILES, TRUTH_FILES, ICON, mapChaptersToFiles, normalizeChapterStatus } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";
import { renderPresetList } from "./presets.js";
import { renderAnalytics } from "./analytics.js";

let currentFile = null;
let isPreview = false;
let autoSaveTimer = null;

// ── Enter / Exit Editor ──

export function openEditor(bookId) {
  state.activeBookId = bookId;
  state.chatContext.bookId = bookId;
  setEditorTabEnabled(true);
  setView("editor");

  // Set title
  const book = state.books.find(b => (b.id || b) === bookId);
  $("editor-book-title").textContent = book?.title || bookId;

  // Load legacy editor-left trees only in modern mode (ink hides .editor-left)
  const style = document.documentElement.getAttribute("data-style") || "ink";
  if (style !== "ink") {
    loadChapterTree(bookId);
    loadWorldTree(bookId);
    loadOutlineTree(bookId);
  }

  // Reset editor
  $("editor-textarea").value = "";
  $("editor-preview").style.display = "none";
  $("editor-textarea").style.display = "";
  $("editor-char-count").textContent = "0 字";
  $("editor-right").classList.remove("open");
  isPreview = false;
  currentFile = null;
}

export function closeEditor() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  setView("dashboard");
  renderDashboard();
}

export function focusEditorForManualEdit() {
  const bookId = state.activeBookId || state.books[0]?.id || state.books[0];
  if (!bookId) {
    showToast("请先选择书籍", "warn");
    return;
  }

  state.activeBookId = bookId;
  state.chatContext.bookId = bookId;
  const select = $("book-select");
  if (select) select.value = bookId;

  if (state.currentView !== "editor") {
    openEditor(bookId);
  }

  isPreview = false;
  $("editor-preview").style.display = "none";
  $("editor-textarea").style.display = "";
  $("editor-textarea").focus();
}

export async function openEditorFile(type, bookId, file) {
  if (state.currentView !== "editor" || state.activeBookId !== bookId) {
    openEditor(bookId);
  }
  await loadFileInEditor(type, bookId, file);
}

// ── Left Tabs ──

export function initEditorTabs() {
  initAIGCKeyboard();
  // Left sidebar tabs
  document.querySelectorAll(".editor-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".editor-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".editor-tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = $("tab-" + tab.dataset.tab);
      if (panel) panel.classList.add("active");
      if (tab.dataset.tab === "presets") renderPresetList();
    });
  });

  // Right AI panel tabs
  document.querySelectorAll(".ai-panel-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ai-panel-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".ai-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = $("panel-" + tab.dataset.panel);
      if (panel) panel.classList.add("active");
    });
  });

  document.querySelectorAll(".ai-drawer-tool").forEach(btn => {
    btn.addEventListener("click", () => {
      const panelName = btn.dataset.openPanel;
      const panelTab = document.querySelector(`.ai-panel-tab[data-panel="${panelName}"]`);
      if (panelTab) panelTab.click();
      $("editor-right").classList.add("open");
    });
  });

  // Editor mode buttons (topbar)
  document.querySelectorAll(".editor-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".editor-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      // Future: switch between write/outline/settings views within editor
    });
  });

  // Back button
  $("editor-back").addEventListener("click", closeEditor);

  // Analytics button
  $("editor-analytics")?.addEventListener("click", () => {
    setView("analytics");
    renderAnalytics();
  });

  // AI panel toggle
  $("editor-toggle-ai").addEventListener("click", () => {
    $("editor-right").classList.toggle("open");
  });

  // Toolbar commands
  $("editor-toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (!btn) return;
    handleToolbarCmd(btn.dataset.cmd);
  });

  // Editor textarea events
  const textarea = $("editor-textarea");
  textarea.addEventListener("input", () => {
    updateCharCount();
    scheduleAutoSave();
  });

  // AI panel send
  $("ai-panel-send").addEventListener("click", sendEditorChat);
  $("ai-panel-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendEditorChat();
    }
  });

  // Continue writing
  const continueBtn = $("ai-continue-btn");
  if (continueBtn) continueBtn.addEventListener("click", continueWriting);

  // Summary generation
  const summaryBtn = $("ai-gen-summary");
  if (summaryBtn) summaryBtn.addEventListener("click", generateSummary);

  // Revise mode buttons
  document.querySelectorAll(".revise-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".revise-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      triggerRevise(btn.dataset.mode);
    });
  });
}

// ── Chapter Tree ──

async function loadChapterTree(bookId) {
  const tree = $("editor-chapter-tree");
  tree.innerHTML = '<div class="sidebar-empty">加载中...</div>';

  let chapters = [];
  let chapterFiles = [];

  try {
    const [indexRes, filesRes] = await Promise.all([
      requestJson(`/api/chapters?bookId=${encodeURIComponent(bookId)}`).catch(() => null),
      requestJson(`/api/book-files?bookId=${encodeURIComponent(bookId)}`).catch(() => null),
    ]);
    if (indexRes?.ok && indexRes.data) {
      chapters = Array.isArray(indexRes.data) ? indexRes.data : (indexRes.data.chapters ?? []);
    }
    if (filesRes?.ok && Array.isArray(filesRes.files)) {
      chapterFiles = filesRes.files;
    }
  } catch {}

  const sorted = mapChaptersToFiles(chapters, chapterFiles);

  if (!sorted.length) {
    tree.innerHTML = '<div class="sidebar-empty">暂无章节</div>';
    return;
  }

  tree.innerHTML = sorted.map(([file, meta]) => {
    const label = meta ? `第${meta.number}章: ${meta.title || ""}` : file.replace(/\.md$/, "");
    const normalizedStatus = normalizeChapterStatus(meta?.status);
    const badge = normalizedStatus === "approved" ? '<span class="tree-node-badge pass">&#x2713;</span>'
      : normalizedStatus === "audit-failed" ? '<span class="tree-node-badge fail">&#x2717;</span>'
      : "";
    return `<button class="tree-node" data-type="chapter" data-file="${escapeHtml(file)}">
      <span class="tree-node-icon">${ICON.chapter}</span>
      <span class="tree-node-label">${escapeHtml(label)}</span>
      ${badge}
    </button>`;
  }).join("");

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      loadFileInEditor("chapter", state.activeBookId, node.dataset.file);
    });
  });
}

// ── World Tree (Story + Truth Files) ──

async function loadWorldTree(bookId) {
  const tree = $("editor-world-tree");
  tree.innerHTML = TRUTH_FILES.map(tf => `
    <button class="tree-node" data-type="story-file" data-file="${escapeHtml(tf.file)}">
      <span class="tree-node-icon">${tf.icon}</span>
      <span class="tree-node-label">${escapeHtml(tf.label)}</span>
    </button>
  `).join("");

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      loadFileInEditor("story-file", bookId, node.dataset.file);
    });
  });
}

// ── Outline Tree (Three Levels) ──

async function loadOutlineTree(bookId) {
  const tree = $("editor-outline-tree");
  const outlineFiles = [
    { file: "story_bible.md", label: "L1 故事圣经", icon: ICON.bible },
    { file: "volume_outline.md", label: "L2 全书大纲", icon: ICON.outline },
    { file: "chapter_summaries.md", label: "L3 章节摘要", icon: ICON.summary },
    { file: "book_rules.md", label: "写作规则", icon: ICON.rules },
  ];

  tree.innerHTML = outlineFiles.map(f => `
    <button class="tree-node" data-type="story-file" data-file="${escapeHtml(f.file)}">
      <span class="tree-node-icon">${f.icon}</span>
      <span class="tree-node-label">${escapeHtml(f.label)}</span>
    </button>
  `).join("");

  tree.querySelectorAll(".tree-node").forEach(node => {
    node.addEventListener("click", () => {
      tree.querySelectorAll(".tree-node").forEach(n => n.classList.remove("active"));
      node.classList.add("active");
      loadFileInEditor("story-file", bookId, node.dataset.file);
    });
  });
}

// ── Load File into Editor ──

async function loadFileInEditor(type, bookId, file) {
  currentFile = { type, bookId, file };
  $("editor-save-status").textContent = "加载中...";

  // Update chat context
  state.chatContext = {
    targetType: type === "chapter" ? "chapter" : (file === "volume_outline.md" ? "outline" : "brief"),
    bookId,
    file,
  };

  await runAction("加载...", async () => {
    let content = "";
    if (type === "chapter") {
      const res = await requestJson(`/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    } else {
      const res = await requestJson(`/api/story-file?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`);
      content = res.content ?? "";
    }

    $("editor-textarea").value = content;
    if (isPreview) {
      $("editor-preview").innerHTML = renderMarkdown(content);
    }
    updateCharCount();
    $("editor-save-status").textContent = "";
  });

  // Show/hide audit panel for chapters in ink mode
  renderEditorAuditPanel(type, bookId, file);
}

// ── Save ──

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  $("editor-save-status").textContent = "未保存";
  autoSaveTimer = setTimeout(saveCurrentFile, 3000);
}

async function saveCurrentFile() {
  if (!currentFile) return;
  const content = $("editor-textarea").value;
  $("editor-save-status").textContent = "保存中...";

  try {
    const { type, bookId, file } = currentFile;
    const endpoint = type === "chapter"
      ? `/api/chapter?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`
      : `/api/story-file?bookId=${encodeURIComponent(bookId)}&file=${encodeURIComponent(file)}`;
    await requestJson(endpoint, { method: "PUT", body: JSON.stringify({ content }) });
    $("editor-save-status").textContent = "已保存";
  } catch (err) {
    $("editor-save-status").textContent = "保存失败";
    showToast("保存失败: " + err.message, "error");
  }
}

// ── Toolbar ──

function handleToolbarCmd(cmd) {
  const ta = $("editor-textarea");

  if (cmd === "detect") {
    detectAIGC();
    return;
  }

  if (cmd === "preview") {
    isPreview = !isPreview;
    if (isPreview) {
      ta.style.display = "none";
      $("editor-preview").style.display = "";
      $("editor-preview").innerHTML = renderMarkdown(ta.value);
    } else {
      ta.style.display = "";
      $("editor-preview").style.display = "none";
      ta.focus();
    }
    return;
  }

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.substring(start, end);
  let insert = "";

  if (cmd === "bold") insert = `**${selected || "粗体"}**`;
  else if (cmd === "italic") insert = `*${selected || "斜体"}*`;
  else if (cmd === "heading") insert = `\n## ${selected || "标题"}\n`;
  else if (cmd === "ul") insert = `\n- ${selected || "列表项"}\n`;
  else if (cmd === "quote") insert = `\n> ${selected || "引用"}\n`;

  if (insert) {
    ta.setRangeText(insert, start, end, "end");
    ta.focus();
    updateCharCount();
    scheduleAutoSave();
  }
}

function updateCharCount() {
  const text = $("editor-textarea").value;
  $("editor-char-count").textContent = `${text.length} 字`;
}

// ── AI Panel Chat ──

async function sendEditorChat() {
  const input = $("ai-panel-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  const messagesEl = $("ai-panel-messages");
  messagesEl.innerHTML += `<div class="chat-bubble chat-bubble--user"><div class="chat-bubble-content">${escapeHtml(text)}</div></div>`;
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Create streaming bubble
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--ai";
  bubble.innerHTML = '<div class="chat-bubble-content"><span class="stream-cursor"></span></div>';
  messagesEl.appendChild(bubble);
  const contentEl = bubble.querySelector(".chat-bubble-content");

  try {
    const editorContent = $("editor-textarea").value;
    const ctx = state.chatContext;
    const payload = {
      message: text,
      history: [],
      targetType: ctx.targetType || "brief",
      bookId: ctx.bookId || state.activeBookId,
      currentContent: editorContent,
      file: ctx.file || "",
    };

    let accumulated = "";
    const result = await fetchSSE("/api/chat-stream", payload, (token) => {
      accumulated += token;
      contentEl.innerHTML = renderMarkdown(accumulated) + '<span class="stream-cursor"></span>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    const fullText = result.fullText || accumulated;
    const replyMatch = fullText.match(/=== REPLY ===\s*([\s\S]*?)(?==== [A-Z_]+ ===|$)/);
    const updateMatch = fullText.match(/=== UPDATED_TEXT ===\s*([\s\S]*?)(?==== [A-Z_]+ ===|$)/);
    const reply = replyMatch?.[1]?.trim() || fullText.trim();
    const updatedText = updateMatch?.[1]?.trim() || "";

    contentEl.innerHTML = renderMarkdown(reply);

    if (updatedText) {
      state.pendingChatResult = {
        text: updatedText,
        targetType: ctx.targetType,
        bookId: ctx.bookId,
        file: ctx.file,
      };
    }
  } catch (err) {
    contentEl.innerHTML = `Error: ${escapeHtml(err.message)}`;
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Continue Writing ──

async function continueWriting() {
  const bookId = state.activeBookId;
  if (!bookId) { showToast("请先选择书籍", "warn"); return; }

  const count = Number($("ai-continue-count").value) || 1;
  const context = $("ai-continue-context").value;

  await runAction("续写中...", async () => {
    const body = { bookId, count };
    if (context) body.context = context;
    await requestJson("/api/write-next", { method: "POST", body: JSON.stringify(body) });
    showToast("续写完成");
    loadChapterTree(bookId);
  });
}

// ── Summary ──

async function generateSummary() {
  if (!currentFile) { showToast("请先打开章节", "warn"); return; }
  const content = $("editor-textarea").value;
  if (!content) { showToast("章节内容为空", "warn"); return; }

  const panel = $("panel-ai-summary").querySelector(".ai-panel-body");
  panel.innerHTML = '<p class="text-muted">生成中...</p>';

  try {
    const payload = {
      message: "请为以下内容生成简短摘要",
      history: [],
      targetType: "chapter",
      bookId: currentFile.bookId,
      currentContent: content,
      file: currentFile.file,
    };
    const res = await requestJson("/api/chat-refine", { method: "POST", body: JSON.stringify(payload) });
    panel.innerHTML = renderMarkdown(res.reply || res.content || "无结果");
  } catch (err) {
    panel.innerHTML = `<p class="text-muted">失败: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Revise ──

async function triggerRevise(mode) {
  if (!currentFile) { showToast("请先打开章节", "warn"); return; }

  const resultEl = $("revise-result");
  resultEl.innerHTML = '<p class="text-muted">修订中...</p>';

  try {
    const body = {
      bookId: currentFile.bookId,
      file: currentFile.file,
      mode,
      content: $("editor-textarea").value,
    };
    const res = await requestJson("/api/revise", { method: "POST", body: JSON.stringify(body) });
    const revised = res.content || res.reply || "";
    resultEl.innerHTML = `
      <div class="revise-preview">${renderMarkdown(revised)}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn accent btn-sm" id="revise-accept">接受</button>
        <button class="btn ghost btn-sm" id="revise-reject">拒绝</button>
      </div>`;

    $("revise-accept")?.addEventListener("click", () => {
      $("editor-textarea").value = revised;
      updateCharCount();
      scheduleAutoSave();
      resultEl.innerHTML = '<p class="text-muted">已应用</p>';
      showToast("修订已应用");
    });
    $("revise-reject")?.addEventListener("click", () => {
      resultEl.innerHTML = '<p class="text-muted">已拒绝</p>';
    });
  } catch (err) {
    resultEl.innerHTML = `<p class="text-muted">失败: ${escapeHtml(err.message)}</p>`;
  }
}

// ── AIGC Detection ──

let countdownTimer = null;
let countdownRemaining = 8;
let aigcPickerOpen = false;
let detecting = false;
let pickerResolve = null;

const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

function closeAIGCIndicator() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countdownRemaining = 8;
  const indicator = $("aigc-indicator");
  if (indicator) indicator.style.display = "none";
}

function closeAIGCPicker() {
  aigcPickerOpen = false;
  const indicator = $("aigc-indicator");
  if (indicator) indicator.style.display = "none";
  if (pickerResolve) { pickerResolve(null); pickerResolve = null; }
}

function startCountdown() {
  countdownRemaining = 8;
  const countdownEl = document.querySelector(".aigc-countdown");
  if (countdownEl) countdownEl.textContent = countdownRemaining;

  countdownTimer = setInterval(() => {
    countdownRemaining--;
    const el = document.querySelector(".aigc-countdown");
    if (el) el.textContent = countdownRemaining;
    if (countdownRemaining <= 0) closeAIGCIndicator();
  }, 1000);

  // Hover pause
  const indicator = $("aigc-indicator");
  if (indicator) {
    indicator.addEventListener("mouseenter", () => {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    });
    indicator.addEventListener("mouseleave", () => {
      if (countdownRemaining > 0 && !countdownTimer) {
        countdownTimer = setInterval(() => {
          countdownRemaining--;
          const el = document.querySelector(".aigc-countdown");
          if (el) el.textContent = countdownRemaining;
          if (countdownRemaining <= 0) closeAIGCIndicator();
        }, 1000);
      }
    });
  }
}

function initAIGCKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (aigcPickerOpen) { closeAIGCPicker(); }
      else { closeAIGCIndicator(); }
    }
  });
  document.addEventListener("inkos:routechange", closeAIGCIndicator);
  document.addEventListener("inkos:viewchange", closeAIGCIndicator);
}

async function loadDetectionConfig() {
  try {
    const res = await requestJson("/api/detection-config");
    const { ok, ...config } = res;
    return config;
  } catch {
    return {};
  }
}

function getAvailableProviders(config) {
  const providers = config.providers ?? {};
  const available = [];
  for (const [key, val] of Object.entries(providers)) {
    if (val.enabled && val.apiUrl) available.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1) });
  }
  available.push({ key: "claude", label: "Claude 估算" });
  return available;
}

function pickProvider(available) {
  return new Promise((resolve) => {
    pickerResolve = resolve;
    aigcPickerOpen = true;
    let indicator = $("aigc-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "aigc-indicator";
      indicator.className = "aigc-indicator";
      $("editor-center").appendChild(indicator);
    }
    indicator.innerHTML = `
      <div class="aigc-toolbar">
        <button class="btn ghost btn-xs aigc-close" title="取消 (Esc)">&times;</button>
      </div>
      <div class="aigc-label">选择检测方案</div>
      <div class="aigc-picker">
        ${available.map(p => `<button class="aigc-picker-btn" data-provider="${escapeHtml(p.key)}">${escapeHtml(p.label)}</button>`).join("")}
      </div>
      <div class="aigc-esc-hint">按 Esc 取消</div>
    `;
    indicator.style.display = "block";
    indicator.querySelector(".aigc-close")?.addEventListener("click", closeAIGCPicker);
    indicator.querySelectorAll(".aigc-picker-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        aigcPickerOpen = false;
        pickerResolve = null;
        indicator.style.display = "none";
        resolve(btn.dataset.provider);
      });
    });
  });
}

async function detectAIGC() {
  const content = $("editor-textarea").value;
  if (!content) { showToast("编辑器内容为空", "warn"); return; }
  if (detecting) { showToast("检测进行中…", "warn"); return; }

  closeAIGCIndicator();

  const config = await loadDetectionConfig();
  const available = getAvailableProviders(config);
  let chosenProvider;

  if (available.length === 1) {
    chosenProvider = available[0].key;
  } else if (config.defaultProvider && available.some(p => p.key === config.defaultProvider)) {
    chosenProvider = config.defaultProvider;
  } else {
    chosenProvider = await pickProvider(available);
    if (!chosenProvider) return; // User cancelled
  }

  const statusEl = $("editor-save-status");
  statusEl.textContent = "检测中...";
  detecting = true;

  try {
    const isExternal = chosenProvider !== "claude";
    let prob, reasons, suggestion, providerLabel;

    if (isExternal) {
      const res = await requestJson("/api/detect-external", {
        method: "POST",
        body: JSON.stringify({ content: content.slice(0, 8000), provider: chosenProvider }),
      });
      prob = Math.round((res.score ?? 0) * 100);
      reasons = [];
      suggestion = "";
      providerLabel = chosenProvider;
    } else {
      const res = await requestJson("/api/detect", {
        method: "POST", body: JSON.stringify({ content }),
      });
      prob = res.aiProbability ?? 50;
      reasons = res.reasons ?? [];
      suggestion = res.suggestion ?? "";
      providerLabel = "Claude 估算";
    }

    const color = prob > 70 ? "#ef4444" : prob > 40 ? "#f59e0b" : "#22c55e";
    const reasonsHtml = reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("");

    showToast(`AI 概率: ${prob}% (${providerLabel})`, prob > 70 ? "error" : prob > 40 ? "warn" : "success", 8000);

    const reportText = [
      `AI 概率: ${prob}% (${providerLabel})`,
      ...reasons.map(r => `- ${r}`),
      suggestion ? `建议: ${suggestion}` : "",
    ].filter(Boolean).join("\n");

    let indicator = $("aigc-indicator");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "aigc-indicator";
      indicator.className = "aigc-indicator";
      $("editor-center").appendChild(indicator);
    }
    indicator.innerHTML = `
      <div class="aigc-toolbar">
        <span class="aigc-countdown">8</span>
        <button class="btn ghost btn-xs aigc-copy" title="复制检测结果">${COPY_ICON}</button>
        <button class="btn ghost btn-xs aigc-close" title="关闭 (Esc)">&times;</button>
      </div>
      <div class="aigc-score" style="color:${color}">${prob}%</div>
      <div class="aigc-label">AI 概率 · ${escapeHtml(providerLabel)}</div>
      ${reasonsHtml ? `<ul class="aigc-reasons">${reasonsHtml}</ul>` : ""}
      ${suggestion ? `<p class="aigc-suggestion">${escapeHtml(suggestion)}</p>` : ""}
      <div class="aigc-esc-hint">按 Esc 立即关闭</div>
    `;
    indicator.style.display = "block";
    indicator.querySelector(".aigc-close")?.addEventListener("click", closeAIGCIndicator);
    indicator.querySelector(".aigc-copy")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(reportText);
        const btn = indicator.querySelector(".aigc-copy");
        if (btn) { btn.textContent = "已复制"; setTimeout(() => { btn.innerHTML = COPY_ICON; }, 1500); }
      } catch { showToast("复制失败", "error"); }
    });

    startCountdown();
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "";
    showToast("检测失败: " + err.message, "error");
  } finally {
    detecting = false;
  }
}

// ── Ink-mode Audit Panel ──

function findChapterMetaByFile(file) {
  if (!state.chapterIndex) return null;
  const numMatch = file.match(/^(\d+)/);
  if (!numMatch) return null;
  const num = parseInt(numMatch[1], 10);
  return state.chapterIndex.find((ch) => ch.number === num) ?? null;
}

function parseIssueSev(raw) {
  const m = raw.match(/^\[(critical|warning|info)\]\s*/);
  if (!m) return { sev: "info", text: raw };
  return { sev: m[1], text: raw.slice(m[0].length) };
}

const SEV_LABEL = { critical: "严重", warning: "警告", info: "提示" };

function renderEditorAuditPanel(type, bookId, file) {
  const panel = $("editor-audit");
  if (!panel) return;

  // Only show for chapters in ink mode
  const isInk = document.documentElement.getAttribute("data-style") === "ink";
  if (!isInk || type !== "chapter") {
    panel.style.display = "none";
    return;
  }

  const meta = findChapterMetaByFile(file);
  if (!meta) {
    panel.style.display = "none";
    return;
  }

  const issues = meta.auditIssues ?? [];
  const reviewNote = meta.reviewNote ?? "";
  const isAuditFailed = meta.status === "audit-failed" || meta.status === "rejected";

  let html = "";

  // Action buttons row
  html += `<div class="audit-header-actions">
    <button class="btn btn-approve" id="ea-approve" type="button">手动通过</button>
    <button class="btn btn-rewrite" id="ea-rewrite" type="button">重写本章</button>
  </div>`;

  // Spot-fix + re-audit buttons
  html += `<div class="audit-header-actions" style="padding-top:0">
    ${isAuditFailed ? '<button class="btn btn-spotfix-row" id="ea-spotfix" type="button">针对性修订</button>' : ""}
    <button class="btn btn-reaudit" id="ea-reaudit" type="button">重新审计</button>
  </div>`;

  // Title
  html += `<div class="audit-title">审计详情 (${issues.length})</div>`;

  // Scrollable content
  html += `<div class="audit-issue-scroll">`;

  if (reviewNote) {
    html += `<div class="audit-review-note">人工备注：${escapeHtml(reviewNote)}</div>`;
  }

  if (issues.length === 0) {
    html += `<div class="audit-empty-msg">审计通过，无问题</div>`;
  } else {
    for (const raw of issues) {
      const { sev, text } = parseIssueSev(raw);
      html += `<div class="audit-issue-item ${sev}">
        <span class="audit-sev">${SEV_LABEL[sev] ?? sev}</span>
        <span>${escapeHtml(text)}</span>
      </div>`;
    }
  }
  html += `</div>`;

  panel.innerHTML = html;
  panel.style.display = "";

  // Bind actions
  $("ea-approve")?.addEventListener("click", () => editorApprove(bookId, meta.number));
  $("ea-rewrite")?.addEventListener("click", () => editorRewrite(bookId, meta.number));
  $("ea-spotfix")?.addEventListener("click", () => editorSpotfix(bookId, meta.number));
  $("ea-reaudit")?.addEventListener("click", () => editorReaudit(bookId, meta.number));
}

async function editorApprove(bookId, chapterNumber) {
  const note = prompt("（可选）请输入手动通过的原因：");
  if (note === null) return;

  await runAction("提交审核...", async () => {
    const res = await requestJson("/api/chapter-approve", {
      method: "POST",
      body: JSON.stringify({ bookId, chapterNumber, reviewNote: note || undefined }),
    });
    if (res.ok) {
      showToast("已手动通过");
      // Refresh sidebar (updates badge) + chapter index + audit panel
      const { buildSidebarTree } = await import("./sidebar.js");
      await buildSidebarTree(bookId);
      renderEditorAuditPanel("chapter", bookId, currentFile?.file);
    } else {
      showToast(res.error || "操作失败", "error");
    }
  });
}

async function editorRewrite(bookId, chapterNumber) {
  const meta = findChapterMetaByFile(currentFile?.file);
  const chapters = state.chapterIndex ?? [];
  const affected = chapters.filter(c => c.number >= chapterNumber);
  const list = affected.map(c => `  第${c.number}章 ${c.title || ""}`).join("\n");
  if (!confirm(`重写第${chapterNumber}章？\n\n以下章节将被删除并重新生成：\n${list}\n\n此操作不可撤销。`)) return;

  const { openRewritePipeline } = await import("./pipeline.js");
  openRewritePipeline(bookId, chapterNumber);
}

async function editorSpotfix(bookId, chapterNumber) {
  const { openSpotfixPipeline } = await import("./pipeline.js");
  openSpotfixPipeline(bookId, chapterNumber);
}

async function editorReaudit(bookId, chapterNumber) {
  const { openReauditPipeline } = await import("./pipeline.js");
  openReauditPipeline(bookId, chapterNumber);
}

async function refreshChapterIndex(bookId) {
  try {
    const res = await requestJson(`/api/chapters?bookId=${encodeURIComponent(bookId)}`);
    if (res?.ok && res.data) {
      state.chapterIndex = Array.isArray(res.data) ? res.data : (res.data.chapters ?? []);
    }
  } catch {}
}
