// InkOS Studio — Update Notice Popup
import { $, escapeHtml, requestJson, showToast } from "./utils.js";
import { pushModal, popModal } from "./modal-stack.js";
import { navigate } from "./router.js";

let countdownTimer = null;
let countdownRemaining = 8;
let fixInProgress = false;

const MODAL_ID = "update-notice";

const UPDATE_NOTES = [
  "章节标题重生成 — 基于最终正文自动生成文学性标题",
  "主 Pipeline 新增 reaudit + titler 阶段，全流程可视化",
  "新增 skipped 状态 — 跳过的阶段不再假装完成",
  "真相文件空骨架修复 — 缺失 section 自动定向补齐，空骨架不再覆盖旧内容",
  "跳过字数归一化可持久化 — 书籍设置保存默认值，写章弹窗自动读取",
  "settler prompt 升级 — 消除 delta/legacy 协议竞争",
  "章节写作断点续写 + 审计详情面板 + 全文 diff",
  "修复：僵尸锁、断点回放、修订流式分离等多项稳定性修复",
];

function closeNotice() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countdownRemaining = 8;
  fixInProgress = false;
  const el = $("update-notice-overlay");
  if (el) el.style.display = "none";
  popModal(MODAL_ID);
  // Dismiss on server
  requestJson("/api/update-notice/dismiss", { method: "POST" }).catch(() => {});
}

function startCountdown() {
  countdownRemaining = 8;
  updateCountdownDisplay();
  countdownTimer = setInterval(() => {
    if (fixInProgress) return;
    countdownRemaining--;
    updateCountdownDisplay();
    if (countdownRemaining <= 0) closeNotice();
  }, 1000);
}

function updateCountdownDisplay() {
  const el = document.querySelector(".update-notice-countdown");
  if (el) el.textContent = `${countdownRemaining} 秒后自动关闭`;
}

function renderNotice(version, books) {
  let overlay = $("update-notice-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "update-notice-overlay";
    overlay.className = "update-notice-overlay";
    document.body.appendChild(overlay);
  }

  const bookListHtml = books.length > 0
    ? books.map(b => {
        const id = b.id || b;
        const title = b.title || id;
        return `<div class="update-notice-book" data-book-id="${escapeHtml(id)}">
          <span class="update-notice-book-status">·</span>
          <span>${escapeHtml(title)}</span>
          <span class="update-notice-book-result">等待中</span>
        </div>`;
      }).join("")
    : '<div class="update-notice-empty">暂无书籍</div>';

  overlay.innerHTML = `
    <div class="update-notice-card">
      <div class="update-notice-header">
        <span class="update-notice-countdown">${countdownRemaining} 秒后自动关闭</span>
        <button class="update-notice-close" title="关闭">&times;</button>
      </div>
      <h2 class="update-notice-title font-serif">InkOS Studio v${escapeHtml(version)} 更新说明</h2>
      <ul class="update-notice-list">
        ${UPDATE_NOTES.map(n => `<li>${escapeHtml(n)}</li>`).join("")}
      </ul>
      <p class="update-notice-hint">若更新后发现基础文件缺失，可点击下方"一键修复"或前往 About &gt; 修复工具 处理</p>
      <div class="update-notice-progress" id="update-notice-progress">
        ${bookListHtml}
      </div>
      <div class="update-notice-actions">
        <button class="btn accent" id="update-notice-fix" ${books.length === 0 ? "disabled" : ""}>一键修复所有书籍</button>
        <button class="btn ghost" id="update-notice-detail">查看详情</button>
      </div>
      <div class="update-notice-esc">按 Esc 关闭</div>
    </div>
  `;
  overlay.style.display = "flex";

  // Hover pause
  const card = overlay.querySelector(".update-notice-card");
  if (card) {
    card.addEventListener("mouseenter", () => {
      if (countdownTimer && !fixInProgress) { clearInterval(countdownTimer); countdownTimer = null; }
    });
    card.addEventListener("mouseleave", () => {
      if (!countdownTimer && !fixInProgress && countdownRemaining > 0) {
        countdownTimer = setInterval(() => {
          if (fixInProgress) return;
          countdownRemaining--;
          updateCountdownDisplay();
          if (countdownRemaining <= 0) closeNotice();
        }, 1000);
      }
    });
  }

  // Bind events
  overlay.querySelector(".update-notice-close")?.addEventListener("click", closeNotice);
  $("update-notice-fix")?.addEventListener("click", () => runFixAll(books));
  $("update-notice-detail")?.addEventListener("click", () => {
    closeNotice();
    navigate("/about?tab=overview");
  });

  // Register in modal stack
  pushModal(MODAL_ID, closeNotice);
  startCountdown();
}

async function runFixAll(books) {
  fixInProgress = true;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

  const fixBtn = $("update-notice-fix");
  if (fixBtn) fixBtn.disabled = true;

  const progressEl = $("update-notice-progress");
  const bookEls = progressEl?.querySelectorAll(".update-notice-book") ?? [];

  for (let i = 0; i < books.length; i++) {
    const bookId = books[i].id || books[i];
    const el = bookEls[i];
    if (el) {
      el.querySelector(".update-notice-book-status").textContent = "↻";
      el.querySelector(".update-notice-book-result").textContent = "修复中...";
    }

    try {
      const res = await requestJson("/api/fix-foundation", {
        method: "POST",
        body: JSON.stringify({ bookId, direction: "auto" }),
      });
      if (el) {
        if (res.action === "backup") {
          el.querySelector(".update-notice-book-status").textContent = "✓";
          el.querySelector(".update-notice-book-result").textContent = "已备份";
          el.querySelector(".update-notice-book-status").className = "update-notice-book-status success";
        } else if (res.action === "restore") {
          el.querySelector(".update-notice-book-status").textContent = "✓";
          el.querySelector(".update-notice-book-result").textContent = "已恢复";
          el.querySelector(".update-notice-book-status").className = "update-notice-book-status success";
        } else {
          el.querySelector(".update-notice-book-status").textContent = "!";
          el.querySelector(".update-notice-book-result").textContent = "无可恢复快照";
          el.querySelector(".update-notice-book-status").className = "update-notice-book-status warn";
        }
      }
    } catch (err) {
      if (el) {
        el.querySelector(".update-notice-book-status").textContent = "✗";
        el.querySelector(".update-notice-book-result").textContent = "失败";
        el.querySelector(".update-notice-book-status").className = "update-notice-book-status fail";
      }
    }
  }

  fixInProgress = false;
  if (fixBtn) fixBtn.textContent = "修复完成";
}

export async function checkUpdateNotice(books) {
  try {
    const res = await requestJson("/api/update-notice");
    if (res.ok && res.shouldShow) {
      renderNotice(res.currentVersion, books || []);
    }
  } catch {}
}
