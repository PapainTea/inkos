// InkOS Studio — Create / Write / Export Forms
import { state } from "./state.js";
import { $, requestJson, runAction, showToast, setStatus, streamSSE } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { renderDashboard } from "./dashboard.js";

// ── Progress panel helpers ──

function showProgressPanel(panelId) {
  const panel = $(panelId);
  if (panel) panel.style.display = "";
}

function hideProgressPanel(panelId) {
  const panel = $(panelId);
  if (panel) panel.style.display = "none";
}

function appendProgressLine(logId, text, cls = "") {
  const log = $(logId);
  if (!log) return;
  const line = document.createElement("div");
  line.className = `progress-line ${cls}`.trim();
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearProgressPanel(logId) {
  const log = $(logId);
  if (log) log.innerHTML = "";
}

// ── Create Book ──

export async function createBook(e, loadBooks) {
  e.preventDefault();
  const form = $("create-form");
  const fd = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');

  const progressPanel = "create-progress";
  const progressLog = "create-progress-log";

  await runAction("正在创建书籍...", async () => {
    if (btn) btn.disabled = true;
    clearProgressPanel(progressLog);
    showProgressPanel(progressPanel);
    try {
      const body = {
        title: fd.get("title"),
        genre: fd.get("genre"),
        platform: fd.get("platform"),
        targetChapters: Number(fd.get("targetChapters")) || 200,
        chapterWords: Number(fd.get("chapterWords")) || 3000,
        brief: fd.get("brief") || "",
        useProjectBrief: !!form.querySelector('[name="useProjectBrief"]')?.checked,
        writeFirstChapter: !!form.querySelector('[name="writeFirstChapter"]')?.checked,
      };

      const res = await streamSSE("/api/book", body, {
        onProgress(stage) {
          setStatus(stage);
          appendProgressLine(progressLog, stage);
        },
      });

      if (res.ok === false) {
        appendProgressLine(progressLog, res.error || "创建失败", "error");
        throw new Error(res.error || "创建书籍失败");
      }

      const bookId = res.data?.bookId || body.title;
      appendProgressLine(progressLog, `书籍已创建: ${bookId}`, "done");
      showToast(`书籍已创建: ${bookId}`);
      if (loadBooks) await loadBooks();

      // Brief pause so user can see the success line
      await new Promise((r) => setTimeout(r, 800));
      hideProgressPanel(progressPanel);
      setView("dashboard");
      await renderDashboard();
    } catch (err) {
      // Keep progress panel visible on error so user can see what happened
      throw err;
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ── Write Next Chapter ──

export async function writeNext(e) {
  e.preventDefault();
  // Redirect to confirmation modal, carrying over any values the user already filled
  const form = $("write-form");
  const fd = new FormData(form);
  const bookId = fd.get("bookId");
  if (!bookId) { showToast("请先选择书籍", "error"); return; }
  const { openWriteConfirm } = await import("./book-manage.js");
  openWriteConfirm(bookId, {
    count: Number(fd.get("count")) || undefined,
    words: Number(fd.get("words")) || undefined,
    context: fd.get("context") || undefined,
  });
}

// ── Export Book ──

export async function exportBook(e) {
  e.preventDefault();
  const form = $("export-form");
  const fd = new FormData(form);

  await runAction("导出中...", async () => {
    const body = {
      bookId: fd.get("bookId"),
      format: fd.get("format"),
      output: fd.get("output") || "",
      approvedOnly: !!form.querySelector('[name="approvedOnly"]')?.checked,
    };
    await requestJson("/api/export", { method: "POST", body: JSON.stringify(body) });
    showToast("导出完成");
  });
}
