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
  settler: "Settler 状态结算", normalizer: "Normalizer 字数归一化",
  auditor: "Auditor 审计", reviser: "Reviser 修订",
  validator: "Validator 校验真相文件", memory: "同步记忆索引",
  persist: "落盘章节",
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
  { id: "settler",    keywords: ["结算", "settler", "观察", "observer", "回写", "真相文件", "提取"] },
  { id: "normalizer", keywords: ["归一化", "normaliz", "字数归一化"] },
  { id: "auditor",    keywords: ["审计", "audit"] },
  { id: "reviser",    keywords: ["修订", "修复", "revis", "spot-fix", "自动修复"] },
  { id: "validator",  keywords: ["校验", "validat", "状态校验"] },
  { id: "memory",     keywords: ["记忆", "memory", "索引", "同步记忆"] },
  { id: "persist",    keywords: ["落盘", "persist", "章节索引", "更新章节"] },
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

const stageData = new Map(); // id -> { startTime, chars, content, timer, lastRender }

function startStageTimer(id) {
  const d = stageData.get(id);
  if (!d || d.timer) return;
  d.timer = setInterval(() => {
    const card = $(`stage-${id}`);
    if (!card) return;
    const statsEl = card.querySelector(".stage-stats");
    if (statsEl) {
      const elapsed = Math.round((Date.now() - d.startTime) / 1000);
      statsEl.textContent = `${elapsed}s | ${d.chars.toLocaleString()} 字`;
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

// ── Card builders ──

function clearPipeline() {
  stopAllTimers();
  stageData.clear();
  const s = stagesEl();
  if (s) s.innerHTML = "";
  if (statusEl()) statusEl().textContent = "";
}

function addStageCard(id, label) {
  const s = stagesEl();
  if (!s) return;
  stageData.set(id, { startTime: 0, chars: 0, content: "", timer: null, lastRender: 0 });

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
      </div>
      <div class="stage-body">
        <div class="stage-content"></div>
      </div>
    </div>`;

  card.querySelector(".stage-header").addEventListener("click", () => {
    card.classList.toggle("expanded");
  });
  s.appendChild(card);
}

function activateStage(stageId, detail) {
  // Finish previous active
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    c.className = "stage-card done";
    stopStageTimer(c.id.replace("stage-", ""));
  });

  const card = $(`stage-${stageId}`);
  if (!card) return;
  card.className = "stage-card active expanded";

  const d = stageData.get(stageId);
  if (d) { d.startTime = Date.now(); d.chars = 0; d.content = ""; }
  startStageTimer(stageId);

  if (detail) {
    const statsEl = card.querySelector(".stage-stats");
    if (statsEl) statsEl.textContent = detail;
  }
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function appendStageContent(stageId, text) {
  const d = stageData.get(stageId);
  if (!d) return;
  d.content += text;
  d.chars += [...text].filter((c) => c.charCodeAt(0) > 0x2e7f || /\w/.test(c)).length;

  // Throttle markdown rendering to 300ms
  const now = Date.now();
  if (now - d.lastRender < 300) return;
  d.lastRender = now;

  const card = $(`stage-${stageId}`);
  if (!card) return;
  const contentEl = card.querySelector(".stage-content");
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(d.content);
    contentEl.scrollTop = contentEl.scrollHeight;
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
  const card = $(`stage-${stageId}`) || stagesEl()?.querySelector(".stage-card.active");
  if (!card) return;
  let logEl = card.querySelector(".stage-log");
  if (!logEl) {
    logEl = document.createElement("div");
    logEl.className = "stage-log";
    card.querySelector(".stage-body")?.appendChild(logEl);
  }
  const line = document.createElement("div");
  line.className = "stage-log-line";
  line.textContent = text.length > 200 ? text.slice(0, 200) + "..." : text;
  logEl.appendChild(line);
  while (logEl.children.length > 20) logEl.removeChild(logEl.firstChild);
}

function finishAllStages() {
  stopAllTimers();
  stagesEl()?.querySelectorAll(".stage-card.active").forEach((c) => {
    c.className = "stage-card done";
    flushStageContent(c.id.replace("stage-", ""));
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
}

export function isPipelineRunning() { return pipelineRunning; }

// ── Progress handlers ──

function handleProgress(stage) {
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
      const statsEl = activeCard.querySelector(".stage-stats");
      if (statsEl) statsEl.textContent = stage.replace("流式生成中 ", "");
    }
    return;
  }

  const id = matchStage(stage);
  if (id) activateStage(id, stage);
}

function handleContent(text) {
  const activeCard = stagesEl()?.querySelector(".stage-card.active");
  const activeId = activeCard?.id?.replace("stage-", "");
  if (activeId) appendStageContent(activeId, text);
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

  $("pipeline-start")?.addEventListener("click", () => {
    if (pipelineRunning) return;
    const bookId = $("pipeline-book")?.value;
    if (!bookId) { showToast("请先选择书籍", "error"); return; }
    const count = Number($("pipeline-count")?.value) || 1;
    const context = $("pipeline-context")?.value?.trim() || "";
    runWritePipeline(bookId, { count, context });
  });

  // Check for running pipeline on page load
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

    // Replay buffered events
    const fullRes = await requestJson(`/api/pipeline/task/${task.id}`);
    if (fullRes.ok && fullRes.task) {
      for (const entry of fullRes.task.events) {
        replayEvent(entry);
      }
    }

    // Reconnect live SSE
    reconnectSSE(task.id);
  } catch {}
}

function replayEvent(entry) {
  if (entry.event === "progress" && entry.data?.stage) handleProgress(entry.data.stage);
  else if (entry.event === "content" && entry.data?.text) handleContent(entry.data.text);
  else if (entry.event === "log" && entry.data?.text) handleLog(entry.data.text);
}

function reconnectSSE(taskId) {
  const lastTs = Date.now();
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
    stages.push("input", "planner", "composer", "writer", "settler", "normalizer", "auditor", "reviser", "validator", "memory", "persist");
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

  const stages = ["input", "planner", "composer", "writer", "settler", "normalizer", "auditor", "reviser", "validator", "memory", "persist"];
  for (const id of stages) addStageCard(id, STAGE_LABELS[id]);

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
