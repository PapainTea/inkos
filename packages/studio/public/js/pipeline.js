// InkOS Studio — Pipeline View (live streaming timeline)
import { state } from "./state.js";
import { $, escapeHtml, showToast, streamSSE, setStatus, requestJson } from "./utils.js";
import { setView } from "./views.js";
import { navigate } from "./router.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";
import { renderMarkdown } from "./markdown.js";
import {
  chooseOverlayDisplayStageId,
  extractAuditorStageResults,
  formatAuditStageMarkdown,
  resolvePipelineStageLabel,
} from "./pipeline-audit.js";

// ── Constants ──

const STAGE_LABELS = {
  config: "保存书籍配置", architect: "Architect 生成基础设定",
  control: "初始化控制文档", snapshot: "创建初始快照",
  input: "准备章节输入", planner: "Planner 规划章节意图",
  composer: "Composer 组装上下文", writer: "Writer 执笔创作",
  normalizer: "Normalizer 字数归一化", auditor: "Auditor 审计",
  reviser: "Reviser 修订", reaudit: "Auditor 重新审计",
  settler: "Settler 状态结算",
  validator: "Validator 校验真相文件", titler: "生成章节标题",
  persist: "落盘章节",
  memory: "同步记忆索引",
};

const WRITE_STAGES = ["input", "planner", "composer", "writer", "normalizer", "auditor", "reviser", "reaudit", "settler", "validator", "titler", "persist", "memory"];

const REBUILD_STAGES = ["scan", "generate", "outline", "bible", "rules", "persist"];
const REBUILD_LABELS = {
  scan: "读取章节与现有设定", generate: "LLM 生成基础设定",
  outline: "生成卷纲", bible: "生成故事圣经",
  rules: "生成书籍规则", persist: "写入文件",
};

const SPOTFIX_LABELS = {
  "load-audit": "读取现有审计文件", reviser: "Reviser 针对性修订", reaudit: "Auditor 重新审计", settler: "Settler 状态结算",
};
const SPOTFIX_STAGES = ["load-audit", "reviser", "reaudit", "settler"];

const REAUDIT_LABELS = { audit: "Auditor 审计" };
const REAUDIT_STAGES = ["audit"];

const REBUILD_HOOKS_LABELS = {
  persist: "写入伏笔文件",
};

const REBUILD_LEDGER_LABELS = {
  persist: "写入资源账本",
};

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
  { id: "load-audit", keywords: ["读取现有审计文件", "load-audit"] },
  { id: "reaudit",    keywords: ["重新审计", "re-auditing"] },
  { id: "auditor",    keywords: ["审计", "audit"] },
  { id: "reviser",    keywords: ["修订", "修复", "revis", "spot-fix", "自动修复"] },
  { id: "settler",    keywords: ["结算", "settler", "观察", "observer", "真相文件", "提取"] },
  { id: "titler",     keywords: ["生成章节标题", "generating chapter title"] },
  { id: "validator",  keywords: ["校验", "validat", "状态校验"] },
  { id: "persist",    keywords: ["落盘", "persist"] },
  { id: "memory",     keywords: ["记忆", "memory", "同步记忆"] },
  { id: "scan",       keywords: ["读取章节", "scan", "scanning", "现有设定"] },
  { id: "generate",   keywords: ["LLM 生成基础设定", "generat", "生成基础"] },
  { id: "outline",    keywords: ["生成卷纲", "outline", "卷纲"] },
  { id: "bible",      keywords: ["生成故事圣经", "bible", "故事圣经"] },
  { id: "rules",      keywords: ["生成书籍规则", "rules", "书籍规则"] },
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

const stageData = new Map(); // id -> { startTime, endTime, chars, content, displayContent, timer, lastRender }
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

function getStageDisplayText(stage) {
  return stage?.displayContent ?? stage?.content ?? "";
}

function renderStageContent(stageId) {
  const d = stageData.get(stageId);
  if (!d) return;
  const card = $(`stage-${stageId}`);
  if (!card) return;
  const contentEl = card.querySelector(".stage-content");
  const text = getStageDisplayText(d);
  if (!contentEl) return;
  contentEl.innerHTML = text ? renderMarkdown(text) : "";
}

function setStageDisplayContent(stageId, text) {
  const d = stageData.get(stageId);
  if (!d) return;
  d.displayContent = text || null;
  overlayDisplayStageId = stageId;
  renderStageContent(stageId);
  if (streamOverlayOpen) syncStreamOverlay(true);
}

function applyAuditStageResults(kind, response) {
  const results = extractAuditorStageResults(kind, response);
  for (const [stageId, result] of Object.entries(results)) {
    setStageDisplayContent(stageId, formatAuditStageMarkdown(result));
  }
}

function addStageCard(id, label) {
  const s = stagesEl();
  if (!s) return;
  stageData.set(id, { startTime: 0, endTime: 0, chars: 0, content: "", displayContent: null, timer: null, lastRender: 0 });

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
    const text = getStageDisplayText(d);
    if (text) {
      navigator.clipboard.writeText(text).then(() => showToast("已复制"));
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
  if (d) {
    d.startTime = ts || Date.now();
    d.endTime = 0;
    d.chars = 0;
    d.content = "";
    d.displayContent = null;
  }

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
  d.displayContent = null;
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
      renderStageContent(stageId);
    });
  }
}

function flushStageContent(stageId) {
  const d = stageData.get(stageId);
  if (!d) return;
  const card = $(`stage-${stageId}`);
  if (!card) return;
  renderStageContent(stageId);
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

/** Add an end marker to the pipeline timeline */
function addEndMarker(label) {
  const s = stagesEl();
  if (!s) return;
  // Remove existing end marker if any
  s.querySelector(".stage-end-marker")?.remove();
  // Hide the timeline line past the end marker
  const timelineLine = s.closest(".pipeline-timeline")?.querySelector(".timeline-line");
  if (timelineLine) timelineLine.style.bottom = "0";
  const marker = document.createElement("div");
  marker.className = "stage-card stage-end-marker done";
  marker.innerHTML = `
    <div class="stage-node"><span class="stage-dot stage-dot-end"></span></div>
    <div class="stage-main">
      <div class="stage-header">
        <span class="stage-label">${escapeHtml(label)}</span>
      </div>
    </div>`;
  s.appendChild(marker);
}

// ── Global state ──

let pipelineRunning = false;
let currentTaskId = null;
let currentPipelineType = "write";

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
  return chooseOverlayDisplayStageId(null, [...stageData].map(([id, d]) => ({
    id,
    contentLength: d.content.length,
    displayLength: d.displayContent?.length ?? 0,
  })), overlayDisplayStageId);
}

function syncStreamOverlay(force = false) {
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  const activeId = activeCard?.id?.replace("stage-", "");
  const displayId = chooseOverlayDisplayStageId(activeId, [...stageData].map(([id, d]) => ({
    id,
    contentLength: d.content.length,
    displayLength: d.displayContent?.length ?? 0,
  })), overlayDisplayStageId);
  if (!displayId) return;
  const d = stageData.get(displayId);
  overlayDisplayStageId = displayId;
  const label = $("stream-overlay-label");
  if (label) {
    const isActive = displayId === activeId;
    label.textContent = resolvePipelineStageLabel(displayId) + (isActive ? "" : " (已完成)");
  }
  const body = $("stream-overlay-body");
  if (body && d) {
    const isStageActive = displayId === activeId;
    const displayText = getStageDisplayText(d);
    const renderKey = `${displayId}|${isStageActive ? 1 : 0}|${displayText.length}|${displayText.slice(-48)}`;
    if (force || renderKey !== lastOverlayRenderKey) {
      const shouldFollow = overlayFollowState.content || isNearBottom(body, OVERLAY_SCROLL_FOLLOW_THRESHOLD);
      preserveScrollAnchor(body, shouldFollow, () => {
        body.innerHTML = displayText
          ? `<div class="stream-overlay-prose">${renderMarkdown(displayText)}${isStageActive && !d.displayContent ? '<span class="stream-cursor"></span>' : ''}</div>`
          : '<div class="stream-overlay-prose stream-overlay-empty">暂无实时内容</div>';
      });
      lastOverlayRenderKey = renderKey;
    }
  }
  syncStreamOverlayStats();
}

function syncStreamOverlayStats() {
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  const activeId = activeCard?.id?.replace("stage-", "");
  const displayId = chooseOverlayDisplayStageId(activeId, [...stageData].map(([id, d]) => ({
    id,
    contentLength: d.content.length,
    displayLength: d.displayContent?.length ?? 0,
  })), overlayDisplayStageId);
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
    header.textContent = resolvePipelineStageLabel(stageId);
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
      text += `--- ${resolvePipelineStageLabel(stageId)} ---\n`;
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
    const text = getStageDisplayText(d);
    if (text) {
      navigator.clipboard.writeText(text).then(() => showToast("已复制"));
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

function handleTaskStart(taskStart) {
  const payload = typeof taskStart === "string" ? { taskId: taskStart } : (taskStart || {});
  currentTaskId = payload.taskId || null;

  if (payload.type === "rebuild-hooks" || payload.type === "rebuild-ledger") {
    currentPipelineType = payload.type;
    clearPipeline();
    const f = formEl();
    if (f) f.style.display = "none";
    const labelMap = payload.type === "rebuild-ledger" ? REBUILD_LEDGER_LABELS : REBUILD_HOOKS_LABELS;
    const titlePrefix = payload.type === "rebuild-ledger" ? "重建资源账本" : "重建伏笔钩子";
    if (titleEl()) titleEl().textContent = `${titlePrefix}: ${payload.bookTitle || payload.bookId || ""}`;
    for (const stage of payload.stages || []) {
      addStageCard(stage.id, stage.label || labelMap[stage.id] || stage.id);
    }
  }
}

function handleStageStart(data) {
  if (!data?.stageId) return;
  if (statusEl()) {
    statusEl().textContent = data.current && data.total
      ? `分析第 ${data.current}/${data.total} 章`
      : (data.label || resolvePipelineStageLabel(data.stageId));
  }
  activateStage(data.stageId, undefined);
}

function handleStageSkip(data) {
  const stageId = data?.stageId;
  if (!stageId) return;
  const card = $(`stage-${stageId}`);
  if (!card) return;
  // Allow skipping from any state except done (a completed stage should not be retroactively skipped)
  if (card.classList.contains("done")) return;
  card.className = "stage-card skipped";
  const label = card.querySelector(".stage-label");
  if (label) label.textContent = (STAGE_LABELS[stageId] || stageId) + "（跳过）";
}

function handleStageDone(data) {
  const stageId = data?.stageId;
  if (!stageId) return;
  const card = $(`stage-${stageId}`);
  if (!card) return;
  const d = stageData.get(stageId);
  if (d) d.endTime = Date.now();
  stopStageTimer(stageId);
  freezeStageStats(stageId);
  flushStageContent(stageId);
  card.classList.remove("active", "pending");
  card.classList.add("done");
}

// ── Shared SSE callbacks ──

const sseCallbacks = {
  onProgress: handleProgress,
  onContent: handleContent,
  onLog: handleLog,
  onTaskStart: handleTaskStart,
  onStageStart: handleStageStart,
  onStageDone: handleStageDone,
  onStageSkip: handleStageSkip,
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
    currentPipelineType = task.type || "write";
    const isRebuild = task.type === "rebuild-foundation";
    const isHookRebuild = task.type === "rebuild-hooks";
    const isLedgerRebuild = task.type === "rebuild-ledger";
    const isSpotfix = task.type === "spotfix";
    const isReaudit = task.type === "reaudit";
    if (titleEl()) {
      if (isRebuild) titleEl().textContent = `重建基础文件: ${task.bookTitle || task.bookId || ""}`;
      else if (isHookRebuild) titleEl().textContent = `重建伏笔钩子: ${task.bookTitle || task.bookId || ""}`;
      else if (isLedgerRebuild) titleEl().textContent = `重建资源账本: ${task.bookTitle || task.bookId || ""}`;
      else if (isSpotfix) titleEl().textContent = `针对性修订: ${task.bookTitle || task.bookId || ""}`;
      else if (isReaudit) titleEl().textContent = `重新审计: ${task.bookTitle || task.bookId || ""}`;
      else if (task.type === "create") titleEl().textContent = "创建新书";
      else titleEl().textContent = "写作实况";
    }
    clearPipeline();
    const f = formEl();
    if (f) f.style.display = "none";

    const labelMap = isRebuild ? REBUILD_LABELS : (isHookRebuild ? REBUILD_HOOKS_LABELS : (isLedgerRebuild ? REBUILD_LEDGER_LABELS : (isSpotfix ? SPOTFIX_LABELS : (isReaudit ? REAUDIT_LABELS : STAGE_LABELS))));
    for (const stage of task.stages) {
      addStageCard(stage.id, stage.label || labelMap[stage.id] || STAGE_LABELS[stage.id] || stage.id);
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

function handleChapterStart(data) {
  if (titleEl()) titleEl().textContent += ` — 第 ${data.current}/${data.total} 章`;
  if (statusEl()) statusEl().textContent = `第 ${data.current}/${data.total} 章 运行中...`;
  if (data.current > 1) {
    finishAllStages();
    // Reset stage cards for the new chapter
    const s = stagesEl();
    if (s) s.innerHTML = "";
    stageData.clear();
    for (const id of WRITE_STAGES) addStageCard(id, STAGE_LABELS[id]);
    activateStage("input", `第 ${data.current} 章启动...`);
  }
}

function handleChapterDone(data) {
  const ok = data.result?.ok !== false;
  applyAuditStageResults("write", data.result);
  if (statusEl()) statusEl().textContent = `第 ${data.current}/${data.total} 章 ${ok ? "完成" : "失败"}`;
}

function replayEvent(entry) {
  if (entry.event === "progress" && entry.data?.stage) handleProgress(entry.data.stage, entry.ts);
  else if (entry.event === "content" && entry.data?.text) handleContent(entry.data.text);
  else if (entry.event === "log" && entry.data?.text) handleLog(entry.data.text);
  else if (entry.event === "chapter-start" && entry.data) handleChapterStart(entry.data);
  else if (entry.event === "chapter-done" && entry.data) handleChapterDone(entry.data);
  else if (entry.event === "stage-start" && entry.data) handleStageStart(entry.data);
  else if (entry.event === "stage-done" && entry.data) handleStageDone(entry.data);
  else if (entry.event === "stage-skip" && entry.data) handleStageSkip(entry.data);
  else if (entry.event === "done" && entry.data) applyAuditStageResults(currentPipelineType, entry.data);
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
  evtSource.addEventListener("chapter-start", (e) => {
    try { handleChapterStart(JSON.parse(e.data)); } catch {}
  });
  evtSource.addEventListener("chapter-done", (e) => {
    try { handleChapterDone(JSON.parse(e.data)); } catch {}
  });
  evtSource.addEventListener("stage-start", (e) => {
    try { handleStageStart(JSON.parse(e.data)); } catch {}
  });
  evtSource.addEventListener("stage-done", (e) => {
    try { handleStageDone(JSON.parse(e.data)); } catch {}
  });
  evtSource.addEventListener("stage-skip", (e) => {
    try { handleStageSkip(JSON.parse(e.data)); } catch {}
  });
  evtSource.addEventListener("done", (e) => {
    try {
      const data = JSON.parse(e.data);
      applyAuditStageResults(currentPipelineType, data);
      finishAllStages();
      if (statusEl()) statusEl().textContent = data.ok === false ? "失败" : "✓ 完成";
      setPipelineRunning(false);
    } catch {}
    evtSource.close();
  });
  evtSource.onerror = () => { evtSource.close(); setPipelineRunning(false); };
}

// ── Pipeline runners ──

export function openWritePipeline(bookId, { autoStart = false, count = 1, words, context = "", skipLengthNormalization = false } = {}) {
  setView("pipeline");
  if (titleEl()) titleEl().textContent = count > 1 ? `批量写作 (${count} 章)` : "写作实况";
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
    runWritePipeline(bookId, { count, words, context, skipLengthNormalization });
  }
}

export async function openRewritePipeline(bookId, chapterNumber, { skipLengthNormalization = false } = {}) {
  setView("pipeline");
  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `重写: ${bookTitle} 第${chapterNumber}章`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  for (const id of WRITE_STAGES) addStageCard(id, STAGE_LABELS[id]);

  if (statusEl()) statusEl().textContent = "回退中...";
  setPipelineRunning(true);
  activateStage("input", chapterNumber > 1 ? `回退到第 ${chapterNumber - 1} 章...` : "回退到初始状态...");

  try {
    const rewriteBody = { bookId, chapterNumber, skipLengthNormalization: !!skipLengthNormalization };
    const res = await streamSSE("/api/chapter-rewrite", rewriteBody, sseCallbacks);
    applyAuditStageResults("rewrite", res);
    finishAllStages();

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "重写失败";
      showToast(res.error || "重写失败", "error");
      return;
    }

    if (statusEl()) statusEl().textContent = `✓ 第${chapterNumber}章重写完成`;
    addEndMarker("重写章节成功");
    showToast(`第${chapterNumber}章重写完成`);
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
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
    if (formData.writeFirstChapter) applyAuditStageResults("create", res);
    finishAllStages();

    if (res.ok === false) {
      const errMsg = res.error || res.data?.error || "创建书籍失败";
      if (statusEl()) statusEl().textContent = "创建失败";
      showToast(errMsg, "error");
      return;
    }

    const bookId = res.data?.bookId || title;
    if (statusEl()) statusEl().textContent = `✓ 创建完成: ${bookId}`;
    addEndMarker("新建新书成功");
    showToast(`书籍已创建: ${bookId}`);
    if (loadBooks) await loadBooks();
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

async function runWritePipeline(bookId, { count = 1, words, context = "", skipLengthNormalization = false } = {}) {
  const f = formEl();
  if (f) f.style.display = "none";

  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = count > 1 ? `写作: ${bookTitle} (${count} 章)` : `写作: ${bookTitle}`;
  clearPipeline();

  for (const id of WRITE_STAGES) addStageCard(id, STAGE_LABELS[id]);

  if (statusEl()) statusEl().textContent = count > 1 ? `批量写作 第 1/${count} 章` : "运行中...";
  setPipelineRunning(true);
  activateStage("input", "正在启动...");

  const body = { bookId, count, sequential: count > 1 };
  if (words) body.words = words;
  if (context) body.context = context;
  body.skipLengthNormalization = !!skipLengthNormalization;

  // Use shared callbacks (chapter-start/chapter-done handled centrally via handleChapterStart/handleChapterDone)
  const multiCallbacks = {
    ...sseCallbacks,
    onChapterStart: handleChapterStart,
    onChapterDone: handleChapterDone,
  };

  try {
    const res = await streamSSE("/api/write-next", body, multiCallbacks);
    applyAuditStageResults("write", res);
    finishAllStages();

    const completed = res.data?.completed || (res.ok ? 1 : 0);
    if (res.ok === false) {
      const errMsg = res.data?.error || res.error || "写作失败";
      if (count > 1 && completed > 0) {
        if (statusEl()) statusEl().textContent = `完成 ${completed}/${count} 章，后续失败`;
        showToast(`完成 ${completed} 章，第 ${completed + 1} 章失败: ${errMsg}`, "error");
      } else {
        if (statusEl()) statusEl().textContent = "写作失败";
        showToast(errMsg, "error");
      }
      if (state.activeBookId) await buildSidebarTree(state.activeBookId);
      return;
    }

    if (statusEl()) statusEl().textContent = count > 1 ? `✓ 完成 ${completed}/${count} 章` : "✓ 写作完成";
    addEndMarker("新建章节成功");
    showToast(count > 1 ? `完成 ${completed} 章写作` : "写作完成");
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

// ── Rebuild Foundation Pipeline ──

let lastRebuildParams = null;
let lastRebuildHooksBookId = null;

export async function openRebuildPipeline(bookId, externalContext, { targetChapters, chapterWordCount } = {}) {
  currentPipelineType = "rebuild-foundation";
  setView("pipeline");
  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `重建基础文件: ${bookTitle}`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  for (const id of REBUILD_STAGES) addStageCard(id, REBUILD_LABELS[id]);

  if (statusEl()) statusEl().textContent = "运行中...";
  setPipelineRunning(true);
  activateStage("scan", "正在读取章节...");

  lastRebuildParams = { bookId, externalContext, targetChapters, chapterWordCount };

  try {
    const body = { bookId };
    if (externalContext) body.externalContext = externalContext;
    if (targetChapters) body.targetChapters = targetChapters;
    if (chapterWordCount) body.chapterWordCount = chapterWordCount;
    const res = await streamSSE("/api/rebuild-foundation", body, sseCallbacks);
    finishAllStages();

    if (res.ok === false) {
      const errMsg = res.data?.error || res.error || "重建失败";
      if (statusEl()) statusEl().textContent = "失败";
      showToast(errMsg, "error");

      const s = stagesEl();
      if (s) {
        const failDiv = document.createElement("div");
        failDiv.className = "pipeline-fail-actions";
        failDiv.innerHTML = `
          <p class="pipeline-fail-error">错误：${escapeHtml(errMsg)}</p>
          <div class="pipeline-fail-buttons">
            <button class="btn ghost" id="rebuild-back-about">返回 About</button>
            <button class="btn accent" id="rebuild-retry">重试重建</button>
          </div>
        `;
        s.appendChild(failDiv);
        document.getElementById("rebuild-back-about")?.addEventListener("click", () => {
          navigate(`/about?tab=repair&bookId=${encodeURIComponent(bookId)}`);
        });
        document.getElementById("rebuild-retry")?.addEventListener("click", () => {
          if (lastRebuildParams) openRebuildPipeline(lastRebuildParams.bookId, lastRebuildParams.externalContext, { targetChapters: lastRebuildParams.targetChapters, chapterWordCount: lastRebuildParams.chapterWordCount });
        });
      }
      return;
    }

    if (statusEl()) statusEl().textContent = "✓ 重建完成";
    addEndMarker("基础文件已重建");
    showToast("基础文件重建完成");
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

export async function openRebuildHooksPipeline(bookId) {
  currentPipelineType = "rebuild-hooks";
  setView("pipeline");
  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `重建伏笔钩子: ${bookTitle}`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  if (statusEl()) statusEl().textContent = "准备重建伏笔...";
  setPipelineRunning(true);
  lastRebuildHooksBookId = bookId;

  try {
    const res = await streamSSE("/api/rebuild-hooks", { bookId }, sseCallbacks);
    finishAllStages();

    if (res.ok === false) {
      const errMsg = res.error || "重建伏笔失败";
      if (statusEl()) statusEl().textContent = "失败";
      showToast(errMsg, "error");

      const s = stagesEl();
      if (s) {
        const failDiv = document.createElement("div");
        failDiv.className = "pipeline-fail-actions";
        failDiv.innerHTML = `
          <p class="pipeline-fail-error">错误：${escapeHtml(errMsg)}</p>
          <div class="pipeline-fail-buttons">
            <button class="btn ghost" id="rebuild-hooks-back-about">返回 About</button>
            <button class="btn accent" id="rebuild-hooks-retry">重试重建</button>
          </div>
        `;
        s.appendChild(failDiv);
        document.getElementById("rebuild-hooks-back-about")?.addEventListener("click", () => {
          navigate(`/about?tab=repair&bookId=${encodeURIComponent(bookId)}`);
        });
        document.getElementById("rebuild-hooks-retry")?.addEventListener("click", () => {
          if (lastRebuildHooksBookId) openRebuildHooksPipeline(lastRebuildHooksBookId);
        });
      }
      return;
    }

    if (statusEl()) statusEl().textContent = "✓ 伏笔钩子重建完成";
    addEndMarker("伏笔钩子已重建");
    const stats = res.data?.stats;
    if (stats) {
      showToast(`重建完成：新增/更新 ${stats.upserted}，回收 ${stats.resolved}，延后 ${stats.deferred}`);
    } else {
      showToast("伏笔钩子重建完成");
    }
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

let lastRebuildLedgerBookId = null;

export async function openRebuildLedgerPipeline(bookId) {
  currentPipelineType = "rebuild-ledger";
  setView("pipeline");
  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `重建资源账本: ${bookTitle}`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  if (statusEl()) statusEl().textContent = "准备重建资源账本...";
  setPipelineRunning(true);
  lastRebuildLedgerBookId = bookId;

  try {
    const res = await streamSSE("/api/rebuild-ledger", { bookId }, sseCallbacks);
    finishAllStages();

    if (res.ok === false) {
      const errMsg = res.error || "重建资源账本失败";
      if (statusEl()) statusEl().textContent = "失败";
      showToast(errMsg, "error");

      const s = stagesEl();
      if (s) {
        const failDiv = document.createElement("div");
        failDiv.className = "pipeline-fail-actions";
        failDiv.innerHTML = `
          <p class="pipeline-fail-error">错误：${escapeHtml(errMsg)}</p>
          <div class="pipeline-fail-buttons">
            <button class="btn ghost" id="rebuild-ledger-back-about">返回 About</button>
            <button class="btn accent" id="rebuild-ledger-retry">重试重建</button>
          </div>
        `;
        s.appendChild(failDiv);
        document.getElementById("rebuild-ledger-back-about")?.addEventListener("click", () => {
          navigate(`/about?tab=repair&bookId=${encodeURIComponent(bookId)}`);
        });
        document.getElementById("rebuild-ledger-retry")?.addEventListener("click", () => {
          if (lastRebuildLedgerBookId) openRebuildLedgerPipeline(lastRebuildLedgerBookId);
        });
      }
      return;
    }

    if (statusEl()) statusEl().textContent = "✓ 资源账本重建完成";
    addEndMarker("资源账本已重建");
    const warnings = res.data?.warnings;
    if (warnings && warnings.length > 0) {
      showToast(`重建完成，但有 ${warnings.length} 条账本警告`);
    } else {
      showToast("资源账本重建完成");
    }
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

// ── Spot-fix Pipeline ──

export async function openSpotfixPipeline(bookId, chapterNumber) {
  setView("pipeline");
  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `针对性修订: ${bookTitle} 第${chapterNumber}章`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  for (const id of SPOTFIX_STAGES) addStageCard(id, SPOTFIX_LABELS[id]);

  if (statusEl()) statusEl().textContent = "审计中...";
  setPipelineRunning(true);

  try {
    const res = await streamSSE("/api/chapter-spotfix", { bookId, chapterNumber }, sseCallbacks);
    applyAuditStageResults("spotfix", res);
    finishAllStages();

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "修订失败";
      showToast(res.error || "修订失败", "error");
      return;
    }

    const data = res.data || {};
    if (data.applied) {
      if (statusEl()) statusEl().textContent = `✓ 第${chapterNumber}章修订完成`;
      addEndMarker(data.passed ? "修订完成，审计通过" : "修订完成，仍有问题待处理");
    } else {
      if (statusEl()) statusEl().textContent = data.passed ? `✓ 第${chapterNumber}章审计通过` : `第${chapterNumber}章无法改善`;
      addEndMarker(data.passed ? "审计已通过，无需修订" : "修订未能改善问题");
    }

    // Full-text diff rendering
    if (data.before && data.after && data.before !== data.after) {
      renderFullTextDiff(data.before, data.after);
    }

    showToast(data.passed ? "修订完成" : "修订完成，仍有问题");

    // Sync sidebar + editor/content after pipeline
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
    await syncEditorAfterPipeline(bookId, chapterNumber);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

// ── Re-audit Pipeline ──

export async function openReauditPipeline(bookId, chapterNumber) {
  setView("pipeline");
  const bookTitle = state.books.find((b) => (b.id || b) === bookId)?.title || bookId;
  if (titleEl()) titleEl().textContent = `重新审计: ${bookTitle} 第${chapterNumber}章`;
  clearPipeline();

  const f = formEl();
  if (f) f.style.display = "none";

  for (const id of REAUDIT_STAGES) addStageCard(id, REAUDIT_LABELS[id]);

  if (statusEl()) statusEl().textContent = "审计中...";
  setPipelineRunning(true);

  try {
    const res = await streamSSE("/api/chapter-reaudit", { bookId, chapterNumber }, sseCallbacks);
    applyAuditStageResults("reaudit", res);
    finishAllStages();

    if (res.ok === false) {
      if (statusEl()) statusEl().textContent = "审计失败";
      showToast(res.error || "审计失败", "error");
      return;
    }

    const data = res.data || {};
    if (statusEl()) statusEl().textContent = data.passed ? `✓ 第${chapterNumber}章审计通过` : `第${chapterNumber}章审计未通过`;
    addEndMarker(data.passed ? "审计通过" : `审计未通过 (${data.issueCount ?? "?"} 项问题)`);
    showToast(data.passed ? "审计通过" : "审计未通过");

    // Sync sidebar + editor/content
    if (state.activeBookId) await buildSidebarTree(state.activeBookId);
    await syncEditorAfterPipeline(bookId, chapterNumber);
  } catch (err) {
    if (statusEl()) statusEl().textContent = "错误";
    showToast(String(err.message || err), "error");
  } finally {
    setPipelineRunning(false);
  }
}

// ── Post-pipeline editor sync ──

// Only refresh data in background — do NOT switch views (user stays on pipeline to review diff)
async function syncEditorAfterPipeline(bookId, chapterNumber) {
  // sidebar + index already refreshed by buildSidebarTree above
  // When user navigates back to editor/content, loadFileInEditor/showContent
  // will pick up the updated chapter content and audit state automatically.
}

// ── Full-text inline diff ──

function renderFullTextDiff(before, after) {
  const diffBody = $("stream-overlay-diff");
  if (!diffBody) return;

  switchStreamTab("diff");

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const diff = computeLineDiff(beforeLines, afterLines);

  diffBody.innerHTML = "";
  const container = document.createElement("div");
  container.className = "fulltext-diff";

  for (const entry of diff) {
    const div = document.createElement("div");
    if (entry.type === "same") {
      div.className = "fulltext-diff-line same";
      div.textContent = entry.text;
    } else if (entry.type === "del") {
      div.className = "fulltext-diff-line del";
      div.textContent = entry.text;
    } else if (entry.type === "add") {
      div.className = "fulltext-diff-line add";
      div.textContent = entry.text;
    }
    container.appendChild(div);
  }

  diffBody.appendChild(container);
  updateDiffBadge();
}

function computeLineDiff(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const stack = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: "same", text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: "del", text: oldLines[i - 1] });
      i--;
    }
  }

  return stack.reverse();
}
