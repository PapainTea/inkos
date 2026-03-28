// InkOS Studio — Pipeline View (live streaming timeline)
import { state } from "./state.js";
import { $, escapeHtml, showToast, streamSSE, setStatus, requestJson } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";
import { renderMarkdown } from "./markdown.js";

// ── Constants ──

const STAGE_LABELS = {
  config: "保存书籍配置", architect: "Architect 生成基础设定",
  control: "初始化控制文档", snapshot: "创建初始快照",
  input: "准备章节输入", planner: "Planner 规划章节意图",
  composer: "Composer 组装上下文", writer: "Writer 执笔创作",
  normalizer: "Normalizer 字数归一化", auditor: "Auditor 审计",
  reviser: "Reviser 修订", settler: "Settler 状态结算",
  validator: "Validator 校验真相文件", persist: "落盘章节",
  memory: "同步记忆索引",
};

const WRITE_STAGES = ["input", "planner", "composer", "writer", "normalizer", "auditor", "reviser", "settler", "validator", "persist", "memory"];

const STAGE_MAP = [
  { id: "config",     keywords: ["保存书籍配置", "saving book config"] },
  { id: "architect",  keywords: ["基础设定", "foundation", "architect"] },
  { id: "control",    keywords: ["控制文档", "control doc", "初始化控制"] },
  { id: "snapshot",   keywords: ["快照", "snapshot"] },
  { id: "input",      keywords: ["准备章节输入", "prepare"] },
  { id: "planner",    keywords: ["规划", "planner", "plan", "章节意图"] },
  { id: "composer",   keywords: ["组装", "composer", "compose", "运行时上下文"] },
  { id: "writer",     keywords: ["撰写", "写作", "writer", "执笔", "创作正文", "章节草稿"] },
  { id: "normalizer", keywords: ["归一化", "normaliz", "字数归一化"] },
  { id: "auditor",    keywords: ["审计", "audit"] },
  { id: "reviser",    keywords: ["修订", "修复", "revis", "spot-fix", "自动修复"] },
  { id: "settler",    keywords: ["结算", "settler", "观察", "observer", "真相文件", "提取"] },
  { id: "validator",  keywords: ["校验", "validat", "状态校验"] },
  { id: "persist",    keywords: ["落盘", "persist"] },
  { id: "memory",     keywords: ["记忆", "memory", "同步记忆"] },
];

function matchStage(text) {
  const lower = text.toLowerCase();
  for (const s of STAGE_MAP) {
    if (s.keywords.some((k) => lower.includes(k.toLowerCase()))) return s.id;
  }
  return null;
}

// ── DOM ──

const stagesEl = () => $("pipeline-stages");
const titleEl = () => $("pipeline-title");
const statusEl = () => $("pipeline-status");
const formEl = () => $("pipeline-form");

// ── Per-stage state ──

const stageData = new Map(); // id -> { startTime, endTime, chars, content, timer, lastRender }
const diffData = new Map();  // stageId -> [{ type:'add'|'del', text:string }]
let replaying = false;
const STAGE_SCROLL_FOLLOW_THRESHOLD = 72;
const OVERLAY_SCROLL_FOLLOW_THRESHOLD = 96;
const overlayFollowState = { content: true, diff: true };
let overlayDisplayStageId = null;
let lastOverlayRenderKey = "";

function startStageTimer(id) {
  const d = stageData.get(id);
  if (!d || d.timer) return;
  d.timer = setInterval(() => {
    const card = $(`stage-${id}`);
    if (!card) return;
    const el = card.querySelector(".stage-stats");
    if (el) {
      const elapsed = Math.round((Date.now() - d.startTime) / 1000);
      el.textContent = `${elapsed}s | ${d.chars.toLocaleString()} 字`;
    }
  }, 1000);
}

function stopStageTimer(id) {
  const d = stageData.get(id);
  if (d?.timer) { clearInterval(d.timer); d.timer = null; }
}

function stopAllTimers() {
  for (const [id] of stageData) stopStageTimer(id);
}

function freezeStageStats(id) {
  const d = stageData.get(id);
  if (!d || !d.startTime) return;
  const end = d.endTime || Date.now();
  const elapsed = Math.round((end - d.startTime) / 1000);
  const card = $(`stage-${id}`);
  if (!card) return;
  const el = card.querySelector(".stage-stats");
  if (el) el.textContent = `${elapsed}s | ${d.chars.toLocaleString()} 字`;
}

function isNearBottom(el, threshold = OVERLAY_SCROLL_FOLLOW_THRESHOLD) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function preserveScrollAnchor(el, shouldFollow, render) {
  if (!el) {
    render();
    return;
  }

  const previousTop = el.scrollTop;
  render();
  if (shouldFollow) {
    el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTop = previousTop;
  }
}

function setOverlayFollow(kind, shouldFollow) {
  overlayFollowState[kind] = shouldFollow;
  const target = kind === "diff" ? $("stream-overlay-diff") : $("stream-overlay-body");
  if (target) target.setAttribute("data-follow", shouldFollow ? "true" : "false");
}

function bindOverlayScrollTracking() {
  const body = $("stream-overlay-body");
  if (body && body.dataset.scrollBound !== "true") {
    body.dataset.scrollBound = "true";
    body.addEventListener("scroll", () => {
      setOverlayFollow("content", isNearBottom(body, OVERLAY_SCROLL_FOLLOW_THRESHOLD));
    }, { passive: true });
  }

  const diffBody = $("stream-overlay-diff");
  if (diffBody && diffBody.dataset.scrollBound !== "true") {
    diffBody.dataset.scrollBound = "true";
    diffBody.addEventListener("scroll", () => {
      setOverlayFollow("diff", isNearBottom(diffBody, OVERLAY_SCROLL_FOLLOW_THRESHOLD));
    }, { passive: true });
  }
}

// ── Card builders ──

function clearPipeline() {
  stopAllTimers();
  stageData.clear();
  diffData.clear();
  overlayDisplayStageId = null;
  lastOverlayRenderKey = "";
  setOverlayFollow("content", true);
  setOverlayFollow("diff", true);
  const s = stagesEl();
  if (s) s.innerHTML = "";
  if (statusEl()) statusEl().textContent = "";
  // Clear overlay diff panel
  const diffBody = $("stream-overlay-diff");
  if (diffBody) {
    diffBody.innerHTML = '<div class="diff-view-empty" id="diff-view-empty"><span>暂无修改对比</span><span>Normalizer / Reviser 阶段产生的修改将显示在此处</span></div>';
  }
  updateDiffBadge();
}

function addStageCard(id, label) {
  const s = stagesEl();
  if (!s) return;
  stageData.set(id, { startTime: 0, endTime: 0, chars: 0, content: "", timer: null, lastRender: 0 });

  const card = document.createElement("div");
  card.className = "stage-card pending";
  card.id = `stage-${id}`;
  card.innerHTML = `
    <div class="stage-node"><span class="stage-dot"></span></div>
    <div class="stage-main">
      <div class="stage-header">
        <span class="stage-toggle">&#9654;</span>
        <span class="stage-label">${escapeHtml(label)}</span>
        <span class="stage-stats font-code"></span>
        <button class="stage-copy-btn" title="复制内容" data-stage="${id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
      </div>
      <div class="stage-body">
        <div class="stage-content"></div>
      </div>
    </div>`;

  card.querySelector(".stage-header").addEventListener("click", (e) => {
    if (e.target.closest(".stage-copy-btn")) return;
    card.classList.toggle("expanded");
  });
  card.querySelector(".stage-copy-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const d = stageData.get(id);
    if (d?.content) {
      navigator.clipboard.writeText(d.content).then(() => showToast("已复制"));
    }
  });
  s.appendChild(card);
}

function activateStage(stageId, detail, ts) {
  const card = $(`stage-${stageId}`);
  if (!card) return;

  if (card.classList.contains("done") || card.classList.contains("active")) {
    if (detail) appendStageLog(stageId, detail);
    return;
  }

  // Finish previous active
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    const prevId = c.id.replace("stage-", "");
    const pd = stageData.get(prevId);
    if (pd) pd.endTime = ts || Date.now();
    stopStageTimer(prevId);
    freezeStageStats(prevId);
    flushStageContent(prevId);
    c.className = "stage-card done";
  });

  card.className = "stage-card active expanded";

  const d = stageData.get(stageId);
  if (d) { d.startTime = ts || Date.now(); d.endTime = 0; d.chars = 0; d.content = ""; }

  if (!replaying) {
    startStageTimer(stageId);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (streamOverlayOpen) syncStreamOverlay();
  }

  if (detail) {
    const el = card.querySelector(".stage-stats");
    if (el) el.textContent = detail;
  }
}

function appendStageContent(stageId, text) {
  const d = stageData.get(stageId);
  if (!d) return;
  d.content += text;
  d.chars += [...text].filter((c) => c.charCodeAt(0) > 0x2e7f || /\w/.test(c)).length;

  if (replaying) return;

  const now = Date.now();
  if (now - d.lastRender < 300) return;
  d.lastRender = now;

  const card = $(`stage-${stageId}`);
  if (!card) return;
  const contentEl = card.querySelector(".stage-content");
  if (contentEl) {
    const shouldFollow = isNearBottom(contentEl, STAGE_SCROLL_FOLLOW_THRESHOLD);
    preserveScrollAnchor(contentEl, shouldFollow, () => {
      contentEl.innerHTML = renderMarkdown(d.content);
    });
  }
}

function flushStageContent(stageId) {
  const d = stageData.get(stageId);
  if (!d) return;
  const card = $(`stage-${stageId}`);
  if (!card) return;
  const contentEl = card.querySelector(".stage-content");
  if (contentEl && d.content) {
    contentEl.innerHTML = renderMarkdown(d.content);
  }
}

function appendStageLog(stageId, text) {
  if (replaying) return; // skip DOM log rendering during replay
  const card = $(`stage-${stageId}`) || stagesEl()?.querySelector(".stage-card.active");
  if (!card) return;
  let logEl = card.querySelector(".stage-log");
  if (!logEl) {
    logEl = document.createElement("div");
    logEl.className = "stage-log";
    card.querySelector(".stage-body")?.appendChild(logEl);
  }
  const line = document.createElement("div");
  const display = text.length > 200 ? text.slice(0, 200) + "..." : text;

  if (text.startsWith("[+]") || text.startsWith("+ ")) {
    line.className = "stage-log-line diff-add";
  } else if (text.startsWith("[-]") || text.startsWith("- ")) {
    line.className = "stage-log-line diff-del";
  } else {
    line.className = "stage-log-line";
  }
  line.textContent = display;
  logEl.appendChild(line);
  while (logEl.children.length > 50) logEl.removeChild(logEl.firstChild);
}

function finishAllStages() {
  stopAllTimers();
  const now = Date.now();
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    const id = c.id.replace("stage-", "");
    const d = stageData.get(id);
    if (d) d.endTime = now;
    freezeStageStats(id);
    flushStageContent(id);
    c.className = "stage-card done";
  });
}

// ── Global state ──

let pipelineRunning = false;
let currentTaskId = null;

function setPipelineRunning(running) {
  pipelineRunning = running;
  const light = $("pipeline-light");
  if (light) {
    light.setAttribute("data-running", running ? "true" : "false");
    light.title = running ? "正在写作" : "写作状态：空闲";
  }
  const gotoBtn = $("pipeline-goto");
  if (gotoBtn) gotoBtn.style.display = running ? "" : "none";
  const streamBtn = $("pipeline-stream-btn");
  if (streamBtn) streamBtn.style.display = running ? "" : "none";
  // Don't auto-close overlay on finish — let user review content/diff
  if (!running && streamOverlayOpen) {
    syncStreamOverlay(true);
    syncStreamOverlayStats();
    syncStreamOverlayDiff();
  }
  restartStreamOverlayTimer();
}

export function isPipelineRunning() { return pipelineRunning; }

// ── Stream overlay ──

let streamOverlayOpen = false;
let streamOverlayTimer = null;
let activeStreamTab = "content"; // 'content' | 'diff'

function restartStreamOverlayTimer() {
  if (streamOverlayTimer) {
    clearInterval(streamOverlayTimer);
    streamOverlayTimer = null;
  }
  if (!streamOverlayOpen || !pipelineRunning) return;
  streamOverlayTimer = setInterval(() => {
    syncStreamOverlayStats();
    if (activeStreamTab === "content") syncStreamOverlay();
  }, 1000);
}

function openStreamOverlay() {
  const overlay = $("stream-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  streamOverlayOpen = true;
  setOverlayFollow("content", true);
  setOverlayFollow("diff", true);
  lastOverlayRenderKey = "";
  switchStreamTab("content");
  syncStreamOverlay(true);
  syncStreamOverlayDiff();
  restartStreamOverlayTimer();
}

function closeStreamOverlay() {
  const overlay = $("stream-overlay");
  if (overlay) overlay.style.display = "none";
  streamOverlayOpen = false;
  if (streamOverlayTimer) { clearInterval(streamOverlayTimer); streamOverlayTimer = null; }
}

function switchStreamTab(tab) {
  activeStreamTab = tab;
  $("stream-overlay")?.setAttribute("data-active-tab", tab);
  const contentTab = $("stream-tab-content");
  const diffTab = $("stream-tab-diff");
  if (contentTab) contentTab.classList.toggle("active", tab === "content");
  if (diffTab) diffTab.classList.toggle("active", tab === "diff");
  if (tab === "diff") {
    updateDiffBadge();
    syncStreamOverlayDiff();
  } else {
    syncStreamOverlay(true);
  }
}

/** Find the stage with the most content (usually writer) */
function findContentStageId() {
  let bestId = null;
  let bestLen = 0;
  for (const [id, d] of stageData) {
    if (d.content.length > bestLen) { bestLen = d.content.length; bestId = id; }
  }
  return bestId;
}

function syncStreamOverlay(force = false) {
  // Show the stage with most content (writer), not just the active stage
  const contentStageId = findContentStageId();
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  const activeId = activeCard?.id?.replace("stage-", "");
  const displayId = contentStageId || activeId;
  if (!displayId) return;
  const d = stageData.get(displayId);
  overlayDisplayStageId = displayId;
  const label = $("stream-overlay-label");
  if (label) {
    const isActive = displayId === activeId;
    label.textContent = (STAGE_LABELS[displayId] || displayId) + (isActive ? "" : " (已完成)");
  }
  const body = $("stream-overlay-body");
  if (body && d) {
    const isStageActive = displayId === activeId;
    const renderKey = `${displayId}|${isStageActive ? 1 : 0}|${d.content.length}|${d.content.slice(-48)}`;
    if (force || renderKey !== lastOverlayRenderKey) {
      const shouldFollow = overlayFollowState.content || isNearBottom(body, OVERLAY_SCROLL_FOLLOW_THRESHOLD);
      preserveScrollAnchor(body, shouldFollow, () => {
        body.innerHTML = d.content
          ? `<div class="stream-overlay-prose">${renderMarkdown(d.content)}${isStageActive ? '<span class="stream-cursor"></span>' : ''}</div>`
          : '<div class="stream-overlay-prose stream-overlay-empty">暂无实时内容</div>';
      });
      lastOverlayRenderKey = renderKey;
    }
  }
  syncStreamOverlayStats();
}

function syncStreamOverlayStats() {
  const contentId = findContentStageId();
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  const activeId = activeCard?.id?.replace("stage-", "");
  const displayId = contentId || activeId;
  if (!displayId) return;
  const d = stageData.get(displayId);
  const el = $("stream-overlay-stats");
  if (el && d) {
    const refTime = d.startTime || Date.now();
    const elapsed = Math.round(((d.endTime || Date.now()) - refTime) / 1000);
    el.textContent = `${elapsed}s | ${d.chars.toLocaleString()} 字`;
  }
}

let overlayRenderTimer = null;
function appendStreamOverlay() {
  if (!streamOverlayOpen || activeStreamTab !== "content") return;
  if (overlayRenderTimer) return;
  overlayRenderTimer = setTimeout(() => {
    overlayRenderTimer = null;
    syncStreamOverlay();
  }, 300);
}

// ── Diff overlay panel ──

function appendDiffLine(stageId, type, text) {
  // Accumulate
  if (!diffData.has(stageId)) diffData.set(stageId, []);
  diffData.get(stageId).push({ type, text });

  // Live-render to overlay if open
  if (streamOverlayOpen) {
    renderDiffLineToOverlay(stageId, type, text);
  }
  updateDiffBadge();
}

function renderDiffLineToOverlay(stageId, type, text) {
  const diffBody = $("stream-overlay-diff");
  if (!diffBody) return;

  // Hide empty state
  const empty = $("diff-view-empty");
  if (empty) empty.style.display = "none";

  // Add stage header if first line for this stage
  if (!diffBody.querySelector(`[data-diff-stage="${stageId}"]`)) {
    const header = document.createElement("div");
    header.className = "diff-view-stage-header";
    header.setAttribute("data-diff-stage", stageId);
    header.textContent = STAGE_LABELS[stageId] || stageId;
    diffBody.appendChild(header);
  }

  const line = document.createElement("div");
  line.className = `diff-view-line ${type}`;
  line.textContent = (type === "add" ? "+ " : "- ") + text;
  diffBody.appendChild(line);

  const shouldFollow = overlayFollowState.diff || isNearBottom(diffBody, OVERLAY_SCROLL_FOLLOW_THRESHOLD);
  if (shouldFollow) {
    diffBody.scrollTop = diffBody.scrollHeight;
  }
}

/** Re-render all accumulated diffs into the overlay (used when opening overlay) */
function syncStreamOverlayDiff() {
  const diffBody = $("stream-overlay-diff");
  if (!diffBody) return;

  // Clear and re-render
  diffBody.innerHTML = "";
  let hasDiffs = false;
  for (const [stageId, lines] of diffData) {
    if (lines.length === 0) continue;
    hasDiffs = true;
    for (const l of lines) {
      renderDiffLineToOverlay(stageId, l.type, l.text);
    }
  }
  if (!hasDiffs) {
    diffBody.innerHTML = '<div class="diff-view-empty" id="diff-view-empty"><span>暂无修改对比</span><span>Normalizer / Reviser 阶段产生的修改将显示在此处</span></div>';
  }
}

function updateDiffBadge() {
  const badge = $("diff-badge");
  if (!badge) return;
  let total = 0;
  for (const [, lines] of diffData) total += lines.length;
  if (total > 0 && activeStreamTab !== "diff") {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.add("visible");
  } else {
    badge.classList.remove("visible");
  }
}

function copyActiveTabContent() {
  if (activeStreamTab === "diff") {
    let text = "";
    for (const [stageId, lines] of diffData) {
      if (lines.length === 0) continue;
      text += `--- ${STAGE_LABELS[stageId] || stageId} ---\n`;
      for (const l of lines) {
        text += (l.type === "add" ? "+ " : "- ") + l.text + "\n";
      }
      text += "\n";
    }
    if (text.trim()) {
      navigator.clipboard.writeText(text.trim()).then(() => showToast("已复制修改对比"));
    }
  } else {
    const d = overlayDisplayStageId ? stageData.get(overlayDisplayStageId) : undefined;
    if (d?.content) {
      navigator.clipboard.writeText(d.content).then(() => showToast("已复制"));
    }
  }
}

// ── Progress handlers ──

function handleProgress(stage, ts) {
  // Diff lines — accumulate + render
  if (stage.startsWith("[+]") || stage.startsWith("[-]")) {
    const activeCard = stagesEl()?.querySelector(".stage-card.active");
    const activeId = activeCard?.id?.replace("stage-", "");
    if (activeId) {
      appendStageLog(activeId, stage);
      const type = stage.startsWith("[+]") ? "add" : "del";
      const text = stage.slice(4); // strip "[+] " or "[-] "
      appendDiffLine(activeId, type, text);
    }
    return;
  }

  setStatus(stage);
  if (statusEl()) statusEl().textContent = stage;

  if (stage.startsWith("⚠") || stage.startsWith("  ")) {
    const activeCard = stagesEl()?.querySelector(".stage-card.active");
    if (activeCard) appendStageLog(activeCard.id.replace("stage-", ""), stage);
    return;
  }

  if (stage.startsWith("流式生成中")) {
    const activeCard = stagesEl()?.querySelector(".stage-card.active");
    if (activeCard) {
      const m = stage.match(/(\d+)\s*chars?(?:.*?(\d+)\s*CJK)?/i);
      if (m) {
        const activeId = activeCard.id.replace("stage-", "");
        const d = stageData.get(activeId);
        if (d && m[2]) d.chars = parseInt(m[2], 10);
        else if (d && m[1]) d.chars = parseInt(m[1], 10);
      }
      const el = activeCard.querySelector(".stage-stats");
      if (el) {
        const d = stageData.get(activeCard.id.replace("stage-", ""));
        const elapsed = d ? Math.round((Date.now() - d.startTime) / 1000) : 0;
        el.textContent = `${elapsed}s | ${d ? d.chars.toLocaleString() : 0} 字`;
      }
    }
    return;
  }

  const id = matchStage(stage);
  if (id) activateStage(id, stage, ts);
}

function handleContent(text) {
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  const activeId = activeCard?.id?.replace("stage-", "");
  if (activeId) {
    appendStageContent(activeId, text);
    appendStreamOverlay(text);
  }
}

function handleLog(text) {
  if (statusEl()) statusEl().textContent = text;
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  if (activeCard) appendStageLog(activeCard.id.replace("stage-", ""), text);
}

function handleTaskStart(taskId) {
  currentTaskId = taskId;
}

// ── Shared SSE callbacks ──

const sseCallbacks = {
  onProgress: handleProgress,
  onContent: handleContent,
  onLog: handleLog,
  onTaskStart: handleTaskStart,
};

// ── Init ──

export function initPipeline() {
  bindOverlayScrollTracking();

  $("pipeline-back")?.addEventListener("click", () => {
    setView("dashboard");
    renderDashboard();
  });

  $("pipeline-light")?.addEventListener("click", () => {
    if (pipelineRunning) setView("pipeline");
  });

  $("pipeline-goto")?.addEventListener("click", () => {
    setView("pipeline");
    requestAnimationFrame(() => {
      const active = stagesEl()?.querySelector(".stage-card.active");
      if (active) active.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  // Stream overlay controls
  $("pipeline-stream-btn")?.addEventListener("click", () => {
    if (streamOverlayOpen) closeStreamOverlay();
    else openStreamOverlay();
  });
  $("stream-overlay-close")?.addEventListener("click", closeStreamOverlay);
  $("stream-overlay-copy")?.addEventListener("click", copyActiveTabContent);

  // Tab switching
  $("stream-tab-content")?.addEventListener("click", () => switchStreamTab("content"));
  $("stream-tab-diff")?.addEventListener("click", () => switchStreamTab("diff"));

  // ESC to close overlay
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && streamOverlayOpen) closeStreamOverlay();
  });

  $("pipeline-start")?.addEventListener("click", () => {
    if (pipelineRunning) return;
    const bookId = $("pipeline-book")?.value;
    if (!bookId) { showToast("请先选择书籍", "error"); return; }
    const count = Number($("pipeline-count")?.value) || 1;
    const context = $("pipeline-context")?.value?.trim() || "";
    runWritePipeline(bookId, { count, context });
  });

  checkPipelineStatus();
}

// ── Refresh recovery ──

async function checkPipelineStatus() {
  try {
    const res = await requestJson("/api/pipeline/status");
    if (!res.running || !res.task) return;

    setPipelineRunning(true);
    setView("pipeline");

    const task = res.task;
    if (titleEl()) titleEl().textContent = task.type === "create" ? "创建新书" : "写作实况";
    clearPipeline();
    const f = formEl();
    if (f) f.style.display = "none";

    for (const stage of task.stages) {
      addStageCard(stage.id, STAGE_LABELS[stage.id] || stage.id);
    }

    replaying = true;
    let lastEventTs = 0;
    const fullRes = await requestJson(`/api/pipeline/task/${task.id}`);
    if (fullRes.ok && fullRes.task) {
      for (const entry of fullRes.task.events) {
        replayEvent(entry);
        if (entry.ts) lastEventTs = entry.ts;
      }
    }

    for (const [id] of stageData) {
      flushStageContent(id);
      const card = $(`stage-${id}`);
      if (card?.classList.contains("done")) freezeStageStats(id);
    }
    replaying = false;

    const activeCard = stagesEl()?.querySelector(".stage-card.active");
    if (activeCard) {
      const activeId = activeCard.id.replace("stage-", "");
      startStageTimer(activeId);
      activeCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    reconnectSSE(task.id, lastEventTs);
  } catch {}
}

function replayEvent(entry) {
  if (entry.event === "progress" && entry.data?.stage) handleProgress(entry.data.stage, entry.ts);
  else if (entry.event === "content" && entry.data?.text) handleContent(entry.data.text);
  else if (entry.event === "log" && entry.data?.text) handleLog(entry.data.text);
}

function reconnectSSE(taskId, lastTs = 0) {
  const evtSource = new EventSource(`/api/pipeline/task/${taskId}/stream?since=${lastTs}`);

  evtSource.addEventListener("progress", (e) => {
    try { handleProgress(JSON.parse(e.data).stage); } catch {}
  });
  evtSource.addEventListener("content", (e) => {
    try { handleContent(JSON.parse(e.data).text); } catch {}
  });
  evtSource.addEventListener("log", (e) => {
    try { handleLog(JSON.parse(e.data).text); } catch {}
  });
  evtSource.addEventListener("done", (e) => {
    try {
      const data = JSON.parse(e.data);
      finishAllStages();
      if (statusEl()) statusEl().textContent = data.ok === false ? "失败" : "✓ 完成";
      setPipelineRunning(false);
    } catch {}
    evtSource.close();
  });
  evtSource.onerror = () => { evtSource.close(); setPipelineRunning(false); };
}

// ── Pipeline runners ──

export function openWritePipeline(bookId, { autoStart = false } = {}) {
  setView("pipeline");
  if (titleEl()) titleEl().textContent = "写作实况";
  clearPipeline();

  const select = $("pipeline-book");
  if (select) {
    select.innerHTML = state.books
      .map((b) => {
        const id = b.id || b;
        const title = b.title || id;
        return `<option value="${escapeHtml(id)}"${id === bookId ? " selected" : ""}>${escapeHtml(title)}</option>`;
      })
      .join("");
  }

  const f = formEl();
  if (f) f.style.display = autoStart ? "none" : "";

  if (autoStart && bookId) {
    runWritePipeline(bookId, { count: 1, context: "" });
  }
}

export async function openCreatePipeline(formData, loadBooks) {
  setView("pipeline");
  const title = formData.title || "新书";
  if (titleEl()) titleEl().textContent = `创建新书: ${title}`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  const stages = ["config", "architect", "control", "snapshot"];
  if (formData.writeFirstChapter) {
    stages.push(...WRITE_STAGES);
  }
  for (const id of stages) addStageCard(id, STAGE_LABELS[id]);

  if (statusEl()) statusEl().textContent = "运行中...";
  setPipelineRunning(true);
  activateStage("config", "正在启动...");

  try {
    const res = await streamSSE("/api/book", formData, sseCallbacks);
    finishAllStages();

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "创建失败";
      showToast(res.error || "创建书籍失败", "error");
      return;
    }

    const bookId = res.data?.bookId || title;
    if (statusEl()) statusEl().textContent = `✓ 创建完成: ${bookId}`;
    showToast(`书籍已创建: ${bookId}`);
    if (loadBooks) await loadBooks();
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

async function runWritePipeline(bookId, { count = 1, context = "" } = {}) {
  const f = formEl();
  if (f) f.style.display = "none";

  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `写作: ${bookTitle}`;
  clearPipeline();

  for (const id of WRITE_STAGES) addStageCard(id, STAGE_LABELS[id]);

  if (statusEl()) statusEl().textContent = "运行中...";
  setPipelineRunning(true);
  activateStage("input", "正在启动...");

  const body = { bookId, count };
  if (context) body.context = context;

  try {
    const res = await streamSSE("/api/write-next", body, sseCallbacks);
    finishAllStages();

    if (res.ok === false) {
      const errMsg = res.data?.error || res.error || "写作失败";
      if (statusEl()) statusEl().textContent = "写作失败";
      showToast(errMsg, "error");
      return;
    }

    if (statusEl()) statusEl().textContent = "✓ 写作完成";
    showToast("写作完成");
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}
