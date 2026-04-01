import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockElement = {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    toggle: ReturnType<typeof vi.fn>;
  };
  focus: ReturnType<typeof vi.fn>;
  innerHTML: string;
  querySelector: ReturnType<typeof vi.fn>;
  querySelectorAll: ReturnType<typeof vi.fn>;
  style: Record<string, string>;
  textContent: string;
  value: string;
};

type ChapterMeta = {
  number: number;
  status: string;
  auditIssues?: string[];
  lengthWarnings?: string[];
  reviewNote?: string;
};

const requestJsonMock = vi.fn();
const runActionMock = vi.fn(async (_message: string, task: () => Promise<unknown>) => await task());
const elements = new Map<string, MockElement>();
const state = {
  books: [{ id: "demo-book", title: "Demo Book" }],
  activeBookId: "demo-book",
  chapterIndex: [] as ChapterMeta[],
  chatContext: {
    bookId: "",
    file: "",
    targetType: "brief",
  },
  contentState: {
    bookId: "",
    content: "",
    file: "",
    isEditing: false,
    type: "",
  },
  currentView: "editor",
};

let currentStyle = "ink";

function createElement(): MockElement {
  return {
    addEventListener: vi.fn(),
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    },
    focus: vi.fn(),
    innerHTML: "",
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    style: { display: "" },
    textContent: "",
    value: "",
  };
}

vi.mock("../../../studio/public/js/state.js", () => ({
  state,
}));

vi.mock("../../../studio/public/js/utils.js", () => ({
  $: (id: string) => elements.get(id) ?? null,
  autoResizeInput: vi.fn(),
  escapeHtml: (value: unknown) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;"),
  fetchSSE: vi.fn(),
  requestJson: requestJsonMock,
  runAction: runActionMock,
  showToast: vi.fn(),
}));

vi.mock("../../../studio/public/js/markdown.js", () => ({
  renderMarkdown: (content: string) => `<p>${content}</p>`,
}));

vi.mock("../../../studio/public/js/views.js", () => ({
  setEditorTabEnabled: vi.fn(),
  setView: vi.fn(),
}));

vi.mock("../../../studio/public/js/sidebar.js", () => ({
  ICON: {},
  STORY_FILES: [],
  TRUTH_FILES: [],
  mapChaptersToFiles: vi.fn(),
  normalizeChapterStatus: (status: string) => status,
}));

vi.mock("../../../studio/public/js/dashboard.js", () => ({
  renderDashboard: vi.fn(),
}));

vi.mock("../../../studio/public/js/presets.js", () => ({
  renderPresetList: vi.fn(),
}));

vi.mock("../../../studio/public/js/analytics.js", () => ({
  renderAnalytics: vi.fn(),
}));

function installGlobals() {
  vi.stubGlobal("document", {
    createElement: () => createElement(),
    documentElement: {
      getAttribute: (name: string) => (name === "data-style" ? currentStyle : null),
    },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  });
}

function resetState() {
  vi.clearAllMocks();
  vi.resetModules();
  elements.clear();
  requestJsonMock.mockReset();
  runActionMock.mockClear();
  currentStyle = "ink";
  state.activeBookId = "demo-book";
  state.chapterIndex = [];
  state.chatContext = {
    bookId: "",
    file: "",
    targetType: "brief",
  };
  state.contentState = {
    bookId: "",
    content: "",
    file: "",
    isEditing: false,
    type: "",
  };
  state.currentView = "editor";
  installGlobals();
}

function installContentElements() {
  elements.set("audit-panel", createElement());
  elements.set("content-body", createElement());
  elements.set("content-editor", createElement());
  elements.set("save-content", createElement());
  elements.set("toggle-edit", createElement());
  elements.set("content-breadcrumb", createElement());
}

function installEditorElements() {
  elements.set("editor-save-status", createElement());
  elements.set("editor-textarea", createElement());
  elements.set("editor-preview", createElement());
  elements.set("editor-char-count", createElement());
  elements.set("editor-audit", createElement());
}

async function renderContentAudit(meta: ChapterMeta) {
  installContentElements();
  state.chapterIndex = [meta];
  requestJsonMock.mockResolvedValueOnce({ content: "chapter body" });

  const modulePath = "../../../studio/public/js/content.js";
  const { showContent } = await import(modulePath);
  await showContent("chapter", "demo-book", "0001_demo.md");

  return elements.get("audit-panel")!;
}

async function renderEditorAudit(meta: ChapterMeta) {
  installEditorElements();
  state.chapterIndex = [meta];
  state.activeBookId = "demo-book";
  state.currentView = "editor";
  requestJsonMock.mockResolvedValueOnce({ content: "chapter body" });

  const modulePath = "../../../studio/public/js/editor.js";
  const { openEditorFile } = await import(modulePath);
  await openEditorFile("chapter", "demo-book", "0001_demo.md");

  return elements.get("editor-audit")!;
}

beforeEach(() => {
  resetState();
});

const targets = [
  {
    name: "content audit panel",
    render: renderContentAudit,
    spotfixMarker: 'id="audit-spotfix-btn"',
  },
  {
    name: "ink editor audit panel",
    render: renderEditorAudit,
    spotfixMarker: 'id="ea-spotfix"',
  },
] as const;

describe("studio audit spot-fix visibility", () => {
  for (const target of targets) {
    it(`${target.name} shows spot-fix when approved chapters still have warning issues`, async () => {
      const panel = await target.render({
        number: 1,
        status: "approved",
        auditIssues: ["[warning] 节奏有明显拖沓"],
      });

      expect(panel.innerHTML).toContain(target.spotfixMarker);
      expect(panel.innerHTML).toContain("手动通过");
      expect(panel.innerHTML).toContain("重写本章");
      expect(panel.innerHTML).toContain("重新审计");
    });

    it(`${target.name} hides spot-fix when issues are info only`, async () => {
      const panel = await target.render({
        number: 1,
        status: "approved",
        auditIssues: ["[info] 建议润色个别表达"],
      });

      expect(panel.innerHTML).not.toContain(target.spotfixMarker);
      expect(panel.innerHTML).toContain("重新审计");
    });

    it(`${target.name} hides spot-fix when failed status has no actionable issues`, async () => {
      const panel = await target.render({
        number: 1,
        status: "audit-failed",
        auditIssues: [],
      });

      expect(panel.innerHTML).not.toContain(target.spotfixMarker);
      expect(panel.innerHTML).toContain("审计通过，无问题");
    });
  }
});

describe("ink editor audit panel css", () => {
  it("adds stronger bottom breathing room and visible rounded corners", () => {
    const cssPath = fileURLToPath(new URL("../../../studio/public/app.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");
    const editorAuditBlock = css.match(/\[data-style="ink"\] \.editor-audit \{[\s\S]*?\n\}/)?.[0] ?? "";
    const scrollBlock = css.match(/\[data-style="ink"\] \.editor-audit \.audit-issue-scroll \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(editorAuditBlock).toContain("max-height: calc(100vh - 148px);");
    expect(editorAuditBlock).toContain("max-height: calc(100dvh - 148px);");
    expect(editorAuditBlock).toContain("border-radius: 20px;");
    expect(editorAuditBlock).toContain("box-sizing: border-box;");
    expect(scrollBlock).toContain("border-radius: 0 0 16px 16px;");
    expect(scrollBlock).toContain("padding: 4px 12px 28px;");
  });
});
