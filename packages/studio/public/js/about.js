// InkOS Studio — About Page (Overview / Repair / Changelog)
import { state } from "./state.js";
import { $, escapeHtml, requestJson, showToast } from "./utils.js";
import { navigate } from "./router.js";

// ── Changelog Data ──

const CHANGELOG = [
  {
    version: "0.2.0.3",
    date: "2026-03-30",
    changes: [
      "更新通知弹窗与基础文件修复工具",
      "About 页面与更新日志",
      "重建基础文件接入 Pipeline",
      "统一弹层 ESC 管理",
    ],
  },
  {
    version: "0.2.0.2",
    date: "2026-03-30",
    changes: [
      "基础文件重建按钮",
      "快照保护（基础文件加入快照）",
      "修复 outline-regenerate 重复构造问题",
    ],
  },
  {
    version: "0.2.0.1",
    date: "2026-03-30",
    changes: [
      "Provider 选择弹框",
      "检测结果 8 秒倒计时自动关闭",
      "Claude Prompt 自定义",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-03-30",
    changes: [
      "AIGC 检测设置页",
      "Path 路由基础设施",
      "Sidebar 幽灵条目修复",
      "审计状态标签修正（approved）",
      "删除 sidebar 创建新书按钮",
      "Ink 主题小屏滚动修复",
    ],
  },
];

// ── Foundation file labels ──

const FOUNDATION_LABELS = {
  "story_bible.md": "故事圣经",
  "volume_outline.md": "全书大纲",
  "book_rules.md": "书籍规则",
};

// ── Internal State ──

let currentTab = "overview";
let currentBookId = "";
let foundationStatus = null;

// ── Render Entry Point ──

export function renderAbout(params = {}) {
  const container = $("about-view");
  if (!container) return;

  currentTab = params.tab || "overview";
  if (params.bookId) currentBookId = params.bookId;
  if (!currentBookId && state.books.length) currentBookId = state.books[0].id;

  container.innerHTML = `
    <div class="about-page">
      <div class="about-header">
        <h1 class="font-serif">关于 InkOS Studio</h1>
      </div>
      <div class="about-tabs">
        <button class="about-tab${currentTab === "overview" ? " active" : ""}" data-tab="overview">概览</button>
        <button class="about-tab${currentTab === "repair" ? " active" : ""}" data-tab="repair">修复工具</button>
        <button class="about-tab${currentTab === "changelog" ? " active" : ""}" data-tab="changelog">更新日志</button>
      </div>
      <div class="about-content" id="about-tab-content"></div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll(".about-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  renderTabContent();
}

function switchTab(tab) {
  currentTab = tab;
  const url = new URL(location.href);
  url.searchParams.set("tab", tab);
  if (currentBookId) url.searchParams.set("bookId", currentBookId);
  history.replaceState(null, "", url.toString());

  // Update active class
  const container = $("about-view");
  if (!container) return;
  container.querySelectorAll(".about-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  renderTabContent();
}

function renderTabContent() {
  const el = document.getElementById("about-tab-content");
  if (!el) return;

  if (currentTab === "overview") renderOverview(el);
  else if (currentTab === "repair") renderRepair(el);
  else if (currentTab === "changelog") renderChangelog(el);
}

// ── Tab: Overview ──

function renderOverview(el) {
  const latest = CHANGELOG[0];
  el.innerHTML = `
    <div class="about-section">
      <h2>版本信息</h2>
      <p>当前版本：<strong>${escapeHtml(latest.version)}</strong>（${escapeHtml(latest.date)}）</p>
    </div>
    <div class="about-section">
      <h2>最近更新</h2>
      <ul>
        ${latest.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}
      </ul>
    </div>
    <div class="about-section">
      <h2>注意事项</h2>
      <p>如果基础文件（大纲、卷纲、人物设定）缺失，部分功能可能无法正常运行。请前往
        <a href="#" id="about-goto-repair">修复工具</a> 检查并修复。</p>
    </div>
    <div class="about-section about-links">
      <h2>链接</h2>
      <ul>
        <li><a href="https://github.com/nicekate/inkOS" target="_blank" rel="noopener">GitHub 仓库</a></li>
        <li><a href="#" id="about-goto-changelog">查看完整更新日志</a></li>
      </ul>
    </div>
  `;

  const gotoRepair = document.getElementById("about-goto-repair");
  if (gotoRepair) gotoRepair.addEventListener("click", (e) => { e.preventDefault(); switchTab("repair"); });

  const gotoChangelog = document.getElementById("about-goto-changelog");
  if (gotoChangelog) gotoChangelog.addEventListener("click", (e) => { e.preventDefault(); switchTab("changelog"); });
}

// ── Tab: Repair Tools ──

function renderRepair(el) {
  const books = state.books || [];
  el.innerHTML = `
    <div class="about-section">
      <h2>基础文件修复</h2>
      <div class="form-field">
        <label for="repair-book-select">选择书籍</label>
        <select id="repair-book-select" class="repair-book-select">
          ${books.length === 0 ? '<option value="">— 无书籍 —</option>' : books.map((b) => `<option value="${escapeHtml(b.id)}"${b.id === currentBookId ? " selected" : ""}>${escapeHtml(b.title || b.id)}</option>`).join("")}
        </select>
      </div>
      <div id="repair-status-area" class="repair-status">
        <p>加载中…</p>
      </div>
      <div class="repair-actions">
        <button class="btn btn-secondary" id="repair-btn-backup" title="备份当前基础文件到修复备份目录">备份到修复备份</button>
        <button class="btn btn-secondary" id="repair-btn-snapshot" title="从最近的快照恢复基础文件">从快照恢复</button>
        <button class="btn btn-secondary" id="repair-btn-smart" title="智能修复：尝试自动补全缺失文件">智能修复</button>
      </div>
    </div>
    <div class="about-section repair-rebuild-section">
      <h2>LLM 重建基础文件</h2>
      <textarea id="repair-rebuild-context" class="repair-textarea" rows="6"
        placeholder="粘贴原有大纲、卷纲、人物设定等（可选）"></textarea>
      <p class="text-muted">重建时将以此内容为主，章节内容为辅；本输入不会保存</p>
      <button class="btn btn-primary" id="repair-btn-rebuild" disabled>重建基础文件 → Pipeline</button>
    </div>
  `;

  // Book select change
  const bookSelect = document.getElementById("repair-book-select");
  if (bookSelect) {
    bookSelect.addEventListener("change", () => {
      currentBookId = bookSelect.value;
      const url = new URL(location.href);
      url.searchParams.set("bookId", currentBookId);
      history.replaceState(null, "", url.toString());
      loadFoundationStatus();
    });
  }

  // Quick fix buttons
  document.getElementById("repair-btn-backup")?.addEventListener("click", () => fixFoundation("backup"));
  document.getElementById("repair-btn-snapshot")?.addEventListener("click", () => fixFoundation("restore"));
  document.getElementById("repair-btn-smart")?.addEventListener("click", () => fixFoundation("auto"));

  // Rebuild button
  document.getElementById("repair-btn-rebuild")?.addEventListener("click", handleRebuild);

  // Load initial status
  loadFoundationStatus();
  updateRebuildButton();
}

async function loadFoundationStatus() {
  const area = document.getElementById("repair-status-area");
  if (!area) return;
  if (!currentBookId) {
    area.innerHTML = "<p>请先选择书籍</p>";
    foundationStatus = null;
    updateRebuildButton();
    return;
  }

  area.innerHTML = "<p>加载中…</p>";
  try {
    const data = await requestJson(`/api/foundation-status?bookId=${encodeURIComponent(currentBookId)}`);
    foundationStatus = data;
    renderFoundationStatus(area, data);
  } catch (err) {
    area.innerHTML = `<p class="text-error">加载失败：${escapeHtml(err.message)}</p>`;
    foundationStatus = null;
  }
  updateRebuildButton();
}

function renderFoundationStatus(area, data) {
  const files = data.files || {};
  const keys = Object.keys(FOUNDATION_LABELS);
  let missingCount = 0;
  keys.forEach((k) => { if (!files[k]) missingCount++; });

  area.innerHTML = `
    <div class="repair-status-summary">当前状态：缺失 ${missingCount}/3</div>
    ${keys.map((k) => {
      const exists = !!files[k];
      return `<div class="repair-status-item">
        <span class="repair-status-icon ${exists ? "exists" : "missing"}">${exists ? "✓" : "✗"}</span>
        <span>${escapeHtml(FOUNDATION_LABELS[k])}</span>
      </div>`;
    }).join("")}
  `;
}

async function fixFoundation(direction) {
  if (!currentBookId) { showToast("请先选择书籍", "error"); return; }
  try {
    const res = await requestJson("/api/fix-foundation", {
      method: "POST",
      body: JSON.stringify({ bookId: currentBookId, direction }),
    });
    showToast(res.message || "操作完成", "success");
    loadFoundationStatus();
  } catch (err) {
    showToast(err.message || "操作失败", "error");
  }
}

async function handleRebuild() {
  if (!currentBookId) return;
  const textarea = document.getElementById("repair-rebuild-context");
  const externalContext = textarea ? textarea.value.trim() : "";
  document.dispatchEvent(
    new CustomEvent("inkos:open-rebuild-pipeline", {
      detail: { bookId: currentBookId, externalContext },
    }),
  );
}

async function updateRebuildButton() {
  const btn = document.getElementById("repair-btn-rebuild");
  if (!btn) return;

  let disabled = false;
  if (!currentBookId) disabled = true;

  // Check if pipeline is running
  if (!disabled) {
    try {
      const status = await requestJson("/api/pipeline/status");
      if (status.running) disabled = true;
    } catch {
      // If we can't check, also check state
    }
  }

  // Check if book has chapters
  if (!disabled) {
    const book = (state.books || []).find((b) => b.id === currentBookId);
    if (book && book.chapterCount === 0) disabled = true;
  }

  btn.disabled = disabled;
}

// ── Tab: Changelog ──

function renderChangelog(el) {
  el.innerHTML = `
    <div class="changelog-list">
      ${CHANGELOG.map((entry) => `
        <div class="changelog-entry">
          <div class="changelog-version">${escapeHtml(entry.version)}</div>
          <div class="changelog-date">${escapeHtml(entry.date)}</div>
          <ul class="changelog-changes">
            ${entry.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}
          </ul>
        </div>
      `).join("")}
    </div>
  `;
}

// ── Init ──

export function initAbout() {
  // no-op — event binding done inside renderAbout after innerHTML
}
