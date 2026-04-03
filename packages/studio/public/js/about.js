// InkOS Studio — About Page (Overview / Repair / Changelog)
import { state } from "./state.js";
import { $, escapeHtml, requestJson, showToast } from "./utils.js";
import { navigate } from "./router.js";

// ── Changelog Data ──

const CHANGELOG = [
  {
    version: "0.2.2.4",
    date: "2026-04-03",
    changes: [
      "【重要】章节标题重生成 — Pipeline 最后阶段基于最终正文生成极具文学性/隐喻/象征寓意的标题，同步更新文件名、index、摘要等全部引用位置",
      "【重要】主 Pipeline 新增 reaudit stage — 修订后的重新审计现在作为独立阶段在前端可见，不再静默执行",
      "【重要】主 Pipeline 新增 titler stage — 标题生成在 settler 之后、persist 之前执行，确保所有落盘文件使用最终标题",
      "【重要】Pipeline 新增 skipped 状态 — 审计通过或无关键问题时，reviser 和 reaudit 明确显示为"跳过"而非假装完成",
      "【重要】真相文件空骨架修复 — settler 缺失 UPDATED_SUBPLOTS/EMOTIONAL_ARCS/CHARACTER_MATRIX/LEDGER 时自动定向补齐",
      "【重要】空骨架伪成功拦截 — 只有表头没有数据行的 truth-file 响应不再被误判为有效更新，保留旧内容并发出 warning",
      "【重要】跳过字数归一化持久化 — 书籍设置页可保存默认值，写章弹窗自动读取，新建书也能设置并首章沿用",
      "【重要】settler prompt 升级 — 明确要求输出完整 UPDATED_SUBPLOTS/EMOTIONAL_ARCS/CHARACTER_MATRIX Markdown，消除 delta/legacy 协议竞争",
      "章节写作断点续写 — Pipeline 支持从中断点恢复，避免重复消耗 token",
      "统一资源账本表头 schema — 所有题材账本格式对齐，合并逻辑按 key 去重",
      "审计详情面板 — 支持查看审计问题详情、手动通过、针对性修订、元信息泄露检测",
      "审计/修订升级为 Pipeline 体验 — spotfix/reaudit 支持全文 diff 和 warning 级别修订",
      "spotfix 重构为索引驱动 — 自动读取已有审计问题，补齐派生文件同步",
      "流式输出全面接通 — spotfix/reaudit 支持 token 级流式预览",
      "修复：僵尸锁阻塞写章 — 2 分钟超时 + PID 检测自动清理过期锁文件",
      "修复：断点恢复流式回放 — 重写时能正确回放已有内容",
      "修复：修订流程三阶段流式分离 — diff 页面不再自动跳转",
      "修复：editorApprove 后刷新 sidebar badge",
      "修复：pipeline 完成后自动同步编辑器/内容视图的章节正文",
      "修复：资源账本重建链路多项问题修正（prompt 对齐、前置检查移除、强制 numericalSystem）",
      "写作确认弹窗新增"设为默认"按钮 — 可直接将跳过归一化保存为本书默认值",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-03-31",
    changes: [
      "【重要】更新通知弹窗 — 每个版本首次启动时提醒更新内容，支持一键修复所有书籍的基础文件",
      "【重要】About 页面 — 集中展示版本信息、修复工具、更新日志和外部链接（/about）",
      "【重要】基础文件双向修复 — 支持备份到 repair-backup、从快照恢复、智能修复三种模式",
      "【重要】重建基础文件接入 Pipeline — 从已有章节反推大纲/圣经/规则，支持粘贴原有大纲作为主要依据，实时显示 6 阶段进度",
      "【重要】rewrite 后自动重建 memory.db — 清除未来章节的记忆污染，防止回滚后剧情泄漏",
      "【重要】rewrite 快照预检 — 删除文件前验证快照完整性，避免先删后恢复失败的半破坏状态",
      "【重要】重建伏笔钩子 — 逐章重放精确还原埋设/推进/回收时序，同步更新 pending_hooks、hooks.json 和 memory.db",
      "【重要】重建资源账本 — 逐章重放资源变动重建 particle_ledger.md（仅数值系统题材）",
      "【重要】重建快照同步 — 伏笔/账本写入各章快照目录，大纲写入快照 0，回滚后数据一致",
      "【重要】重建流式预览 — 三条重建链路支持实时 LLM 输出，Pipeline 界面逐 token 显示",
      "修复：delta 格式下伏笔池/资源账本写入丢失 — saveChapter 不再覆盖为空或占位符",
      "修复：delta 路径补充提取 UPDATED_LEDGER 等旧标签，恢复逐章更新能力",
      "快照机制全面升级 — 新增 story_bible、volume_outline、book_rules、author_intent、current_focus 备份",
      "restoreState 同步升级 — 恢复时也还原 author_intent 和 current_focus",
      "AIGC 检测设置页 — 支持 GPTZero/Originality/Custom/Claude 多 Provider 配置（/detection）",
      "检测 UI 改进 — 多 Provider 选择弹框、8秒倒计时自动关闭、复制/关闭按钮、ESC 关闭",
      "Claude 检测 Prompt 可自定义 — 内置默认 prompt 显示为灰色 placeholder",
      "统一弹层 ESC 管理 — modal stack 机制，最上层弹层优先响应 Esc",
      "Path 路由基础设施 — SPA 客户端路由，支持浏览器前进/后退/刷新",
      "Sidebar 幽灵条目修复 — padStart(3) 改为按章节号解析匹配",
      "审计状态标签修正 — 审计通过现在正确显示为「通过」而非「待审」",
      "Ink 主题小屏滚动修复 — sidebar 整栏可滚动",
      "安装版 genre profile 修复 — pkg 打包后 genres/ 自动复制到 projectRoot",
      "创建新书错误信息透传修复",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-03-30",
    changes: [
      "首个 Studio 安装版发布",
      "NSIS 安装包打包",
      "基础 Web UI 功能",
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
      <div class="repair-params">
        <label class="form-field">
          <span>预计总章数</span>
          <input type="number" id="repair-target-chapters" min="1" max="9999" value="200" />
        </label>
        <label class="form-field">
          <span>每章字数</span>
          <input type="number" id="repair-chapter-words" min="500" max="20000" value="3000" />
        </label>
      </div>
      <textarea id="repair-rebuild-context" class="repair-textarea" rows="6"
        placeholder="粘贴原有大纲、卷纲、人物设定等（可选）"></textarea>
      <p class="text-muted">重建时将以此内容为主，章节内容为辅；本输入不会保存</p>
      <button class="btn btn-primary" id="repair-btn-rebuild" disabled>重建基础文件 → Pipeline</button>
    </div>
    <div class="about-section repair-rebuild-section">
      <h2>LLM 重建伏笔钩子</h2>
      <p class="text-muted">从第 1 章到当前章节逐章重放伏笔状态，重建 pending_hooks、hooks.json 与 memory.db hooks。</p>
      <button class="btn btn-primary" id="repair-btn-rebuild-hooks" disabled>重建伏笔钩子 → Pipeline</button>
    </div>
    <div class="about-section repair-rebuild-section">
      <h2>LLM 重建资源账本</h2>
      <p class="text-muted">从第 1 章到当前章节逐章重放资源变动，重建 particle_ledger.md。仅对有数值系统的题材可用。</p>
      <button class="btn btn-primary" id="repair-btn-rebuild-ledger" disabled>重建资源账本 → Pipeline</button>
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
  document.getElementById("repair-btn-rebuild-hooks")?.addEventListener("click", handleRebuildHooks);
  document.getElementById("repair-btn-rebuild-ledger")?.addEventListener("click", handleRebuildLedger);

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
  const targetChapters = parseInt(document.getElementById("repair-target-chapters")?.value, 10) || 200;
  const chapterWordCount = parseInt(document.getElementById("repair-chapter-words")?.value, 10) || 3000;
  document.dispatchEvent(
    new CustomEvent("inkos:open-rebuild-pipeline", {
      detail: { bookId: currentBookId, externalContext, targetChapters, chapterWordCount },
    }),
  );
}

async function handleRebuildHooks() {
  if (!currentBookId) return;
  document.dispatchEvent(
    new CustomEvent("inkos:open-rebuild-hooks-pipeline", {
      detail: { bookId: currentBookId },
    }),
  );
}

async function handleRebuildLedger() {
  if (!currentBookId) return;
  document.dispatchEvent(
    new CustomEvent("inkos:open-rebuild-ledger-pipeline", {
      detail: { bookId: currentBookId },
    }),
  );
}

async function updateRebuildButton() {
  const btn = document.getElementById("repair-btn-rebuild");
  const hooksBtn = document.getElementById("repair-btn-rebuild-hooks");
  const ledgerBtn = document.getElementById("repair-btn-rebuild-ledger");
  if (!btn && !hooksBtn && !ledgerBtn) return;

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

  if (btn) btn.disabled = disabled;
  if (hooksBtn) hooksBtn.disabled = disabled;
  if (ledgerBtn) ledgerBtn.disabled = disabled;
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
