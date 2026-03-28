// InkOS Studio — Dashboard (Book Shelf)
import { state } from "./state.js";
import { $, escapeHtml, requestJson } from "./utils.js";
import { setView } from "./views.js";
import { buildSidebarTree } from "./sidebar.js";
import { openEditor } from "./editor.js";

// Genre -> gradient color scheme
const GENRE_COLORS = {
  xuanhuan: { from: "#7c3aed", to: "#c084fc", accent: "#a855f7" },
  xianxia:  { from: "#0e7490", to: "#67e8f9", accent: "#06b6d4" },
  urban:    { from: "#c2410c", to: "#fdba74", accent: "#ea580c" },
  horror:   { from: "#991b1b", to: "#fca5a5", accent: "#dc2626" },
  scifi:    { from: "#1d4ed8", to: "#93c5fd", accent: "#3b82f6" },
  other:    { from: "#475569", to: "#94a3b8", accent: "#64748b" },
};

function titleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function coverGradient(genre, title) {
  const colors = GENRE_COLORS[genre] || GENRE_COLORS.other;
  const angle = 135 + (titleHash(title || "book") % 90);
  return `linear-gradient(${angle}deg, ${colors.from}, ${colors.to})`;
}

const GENRE_LABELS = {
  xuanhuan: "玄幻", xianxia: "仙侠", urban: "都市",
  horror: "恐怖", scifi: "科幻", other: "其他",
};

const STATUS_LABELS = {
  incubating: "孵化中", outlining: "大纲中", active: "连载中",
  paused: "暂停", completed: "完结", dropped: "弃坑",
};

export async function renderDashboard() {
  const container = $("dashboard-content");
  if (!container) return;

  // Try to get detailed stats
  let bookStats = [];
  try {
    const res = await requestJson("/api/book-stats");
    if (res.ok && Array.isArray(res.data)) bookStats = res.data;
  } catch {
    // Fallback: use state.books
    bookStats = state.books.map(b => ({
      id: b.id || b,
      title: b.title || b.id || b,
      genre: b.genre || "other",
      status: b.status || "active",
      totalWords: 0,
      chapterCount: 0,
      targetChapters: b.targetChapters || 200,
    }));
  }

  if (!bookStats.length) {
    container.innerHTML = `
      <div class="dashboard-empty">
        <div class="dashboard-empty-icon">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="8" y="12" width="48" height="40" rx="8" stroke="currentColor" stroke-width="2" opacity="0.3"/>
            <path d="M24 28h16M24 36h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.3"/>
          </svg>
        </div>
        <p>书架空空如也</p>
        <button class="btn accent" id="dash-empty-create" type="button">+ 创建第一本书</button>
      </div>`;
    const btn = $("dash-empty-create");
    if (btn) btn.addEventListener("click", () => setView("create"));
    return;
  }

  let html = '<div class="book-grid">';

  for (const book of bookStats) {
    const genre = book.genre || "other";
    const genreLabel = GENRE_LABELS[genre] || genre;
    const statusLabel = STATUS_LABELS[book.status] || book.status;
    const gradient = coverGradient(genre, book.title);
    const colors = GENRE_COLORS[genre] || GENRE_COLORS.other;
    const progress = book.targetChapters > 0
      ? Math.min(100, Math.round((book.chapterCount / book.targetChapters) * 100))
      : 0;
    const wordStr = book.totalWords >= 10000
      ? `${(book.totalWords / 10000).toFixed(1)}万字`
      : `${book.totalWords || 0}字`;

    html += `
      <div class="book-card" data-book-id="${escapeHtml(book.id)}">
        <div class="book-card-cover" style="background: ${gradient}">
          <span class="book-card-genre" style="background: ${colors.accent}">${escapeHtml(genreLabel)}</span>
          <div class="book-card-cover-title font-serif">${escapeHtml(book.title)}</div>
        </div>
        <div class="book-card-body">
          <h3 class="book-card-title font-serif">${escapeHtml(book.title)}</h3>
          <div class="book-card-meta">
            <span>${wordStr}</span>
            <span class="book-card-sep">&middot;</span>
            <span>${book.chapterCount}/${book.targetChapters} 章</span>
            <span class="book-card-sep">&middot;</span>
            <span class="book-card-status">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="book-card-progress">
            <div class="book-card-progress-bar" style="width: ${progress}%; background: ${colors.accent}"></div>
          </div>
          <button class="book-card-settings" data-settings-book="${escapeHtml(book.id)}" title="书籍设置">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </div>`;
  }

  // "Create new" card
  html += `
    <div class="book-card book-card--create" id="dash-create-card">
      <div class="book-card-create-inner">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>创建新书</span>
      </div>
    </div>`;

  html += '</div>';
  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll(".book-card[data-book-id]").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".book-card-settings")) return; // handled below
      const bookId = card.dataset.bookId;
      const sel = $("book-select");
      if (sel) sel.value = bookId;
      buildSidebarTree(bookId);
      openEditor(bookId);
    });
  });

  // Settings gear buttons
  container.querySelectorAll(".book-card-settings").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.settingsBook;
      if (bookId && typeof window.openBookSettings === "function") {
        window.openBookSettings(bookId);
      }
    });
  });

  const createCard = $("dash-create-card");
  if (createCard) createCard.addEventListener("click", () => setView("create"));
}
