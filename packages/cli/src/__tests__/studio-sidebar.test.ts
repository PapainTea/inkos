import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJsonMock = vi.fn();
const showContentMock = vi.fn();

const state = {
  books: [],
  activeBookId: "",
  meta: null,
  chatHistory: [],
  pendingChatResult: null,
  currentView: "editor",
  busyCount: 0,
  contentState: {
    type: "",
    bookId: "",
    file: "",
    content: "",
    isEditing: false,
  },
  chatContext: {
    targetType: "brief",
    bookId: "",
    file: "",
  },
  chapterIndex: null,
  chapterFiles: [],
  sidebarCollapsed: false,
  activeTool: "import",
};

const tree = {
  innerHTML: "",
  querySelectorAll: vi.fn(() => []),
};

const sidebarTitle = { textContent: "" };
const sidebarSubtitle = { textContent: "" };

vi.mock("../../../studio/public/js/state.js", () => ({
  state,
}));

vi.mock("../../../studio/public/js/utils.js", () => ({
  $: (id: string) => {
    if (id === "sidebar-tree") return tree;
    if (id === "sidebar-context-title") return sidebarTitle;
    if (id === "sidebar-context-subtitle") return sidebarSubtitle;
    return null;
  },
  escapeHtml: (value: unknown) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;"),
  requestJson: requestJsonMock,
}));

vi.mock("../../../studio/public/js/content.js", () => ({
  showContent: showContentMock,
}));

describe("studio sidebar chapter rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    tree.innerHTML = "";
    state.currentView = "editor";
    state.chapterIndex = null;
    state.chapterFiles = [];
  });

  it("does not duplicate chapter entries when files mix three-digit and four-digit numbering", async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { number: 1, title: "第一章", status: "approved" },
          { number: 2, title: "第二章", status: "approved" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        files: ["001.md", "0002_第二章.md"],
      });

    // @ts-expect-error -- JS module without declarations
    const { buildSidebarTree } = await import("../../../studio/public/js/sidebar.js");
    await buildSidebarTree("demo-book");

    expect((tree.innerHTML.match(/data-type="chapter"/g) ?? [])).toHaveLength(2);
    expect(tree.innerHTML).toContain("第1章: 第一章");
    expect(tree.innerHTML).toContain("第2章: 第二章");
  });

  it("keeps a four-digit placeholder entry when chapter metadata exists but the file is missing", async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { number: 1, title: "缺失章节", status: "approved" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        files: [],
      });

    // @ts-expect-error -- JS module without declarations
    const { buildSidebarTree } = await import("../../../studio/public/js/sidebar.js");
    await buildSidebarTree("demo-book");

    expect(tree.innerHTML).toContain('data-file="0001.md"');
    expect(tree.innerHTML).not.toContain('data-file="001.md"');
  });

  it("renders legacy ready-for-review chapters as passed badges instead of pending review", async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { number: 1, title: "旧状态章节", status: "ready-for-review" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        files: ["0001_旧状态章节.md"],
      });

    // @ts-expect-error -- JS module without declarations
    const { buildSidebarTree } = await import("../../../studio/public/js/sidebar.js");
    await buildSidebarTree("demo-book");

    expect(tree.innerHTML).toContain("通过");
    expect(tree.innerHTML).not.toContain("待审");
  });
});
