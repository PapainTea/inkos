import { beforeEach, describe, expect, it, vi } from "vitest";

const showToastMock = vi.fn();
const setStatusMock = vi.fn();
const setViewMock = vi.fn();
const buildSidebarTreeMock = vi.fn();
const renderDashboardMock = vi.fn();
const requestJsonMock = vi.fn();

const elements = new Map<string, Record<string, unknown>>();
let formValues: Record<string, unknown> = {};

vi.mock("../../../studio/public/js/utils.js", () => ({
  $: (id: string) => elements.get(id),
  requestJson: requestJsonMock,
  runAction: vi.fn(async (_message: string, task: () => Promise<unknown>) => {
    try {
      return await task();
    } catch (err) {
      showToastMock(String((err as Error).message || err), "error");
      return undefined;
    }
  }),
  showToast: showToastMock,
  setStatus: setStatusMock,
}));

vi.mock("../../../studio/public/js/views.js", () => ({
  setView: setViewMock,
}));

vi.mock("../../../studio/public/js/sidebar.js", () => ({
  buildSidebarTree: buildSidebarTreeMock,
}));

vi.mock("../../../studio/public/js/dashboard.js", () => ({
  renderDashboard: renderDashboardMock,
}));

vi.mock("../../../studio/public/js/state.js", () => ({
  state: {
    activeBookId: "",
  },
}));

/** Build a mock Response whose body is an SSE stream. */
function mockSSEResponse(events: Array<{ event: string; data: unknown }>) {
  const lines = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function mockSplitSSEResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("studio frontend regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    elements.clear();
    formValues = {};

    vi.stubGlobal(
      "FormData",
      class MockFormData {
        get(name: string) {
          return formValues[name];
        }
      },
    );
  });

  it("returns to the dashboard and re-renders the bookshelf after creating a book", async () => {
    formValues = {
      title: "新书测试",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "progress", data: { stage: "保存书籍配置" } },
          { event: "progress", data: { stage: "生成基础设定" } },
          { event: "done", data: { ok: true, data: { bookId: "新书测试" } } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(preventDefault).toHaveBeenCalled();
    expect(loadBooksMock).toHaveBeenCalledTimes(1);
    expect(setViewMock).toHaveBeenCalledWith("dashboard");
    expect(renderDashboardMock).toHaveBeenCalledTimes(1);
    expect(setStatusMock).toHaveBeenCalledWith("保存书籍配置");
  });

  it("parses SSE events correctly even when event and data arrive in separate chunks", async () => {
    formValues = {
      title: "分片新书",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSplitSSEResponse([
          "event: progress\n",
          'data: {"stage":"保存书籍配置"}\n\n',
          "event: done\n",
          'data: {"ok":true,"data":{"bookId":"分片新书"}}\n\n',
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(setStatusMock).toHaveBeenCalledWith("保存书籍配置");
    expect(setViewMock).toHaveBeenCalledWith("dashboard");
  });

  it("does not report success when book creation returns ok=false", async () => {
    formValues = {
      title: "失败新书",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "done", data: { ok: false, error: "LLM returned empty response" } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(loadBooksMock).not.toHaveBeenCalled();
    expect(setViewMock).not.toHaveBeenCalledWith("dashboard");
    expect(renderDashboardMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalledWith(expect.stringContaining("书籍已创建"));
    expect(showToastMock).toHaveBeenCalledWith("LLM returned empty response", "error");
  });

  it("surfaces nested create-book errors from res.data.error in the standard create flow", async () => {
    formValues = {
      title: "嵌套错误新书",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "done", data: { ok: false, data: { error: "Book \"-\" already exists" } } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(loadBooksMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Book \"-\" already exists", "error");
  });

  it("treats a successful doctor response with code=0 as connected", async () => {
    const statusEl = { textContent: "", className: "" };
    elements.set("doctor-status", statusEl);

    requestJsonMock.mockResolvedValueOnce({
      code: 0,
      stdout: "doctor ok",
    });

    // @ts-expect-error -- JS module without declarations
    const { runDoctor } = await import("../../../studio/public/js/settings.js");

    await runDoctor();

    expect(requestJsonMock).toHaveBeenCalledWith("/api/doctor");
    expect(statusEl.textContent).toBe("连通正常");
    expect(statusEl.className).toBe("settings-doctor-status ok");
  });

  it("shows English stage updates that come from the server progress stream", async () => {
    formValues = {
      title: "english-stage-book",
      genre: "xuanhuan",
      platform: "tomato",
      targetChapters: "200",
      chapterWords: "3000",
      brief: "",
    };

    elements.set("create-form", {
      querySelector: (selector: string) => {
        if (selector.includes("useProjectBrief")) return { checked: true };
        if (selector.includes("writeFirstChapter")) return { checked: false };
        if (selector.includes("submit")) return { disabled: false };
        return null;
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "progress", data: { stage: "Stage: Persisting project files" } },
          { event: "done", data: { ok: true, data: { bookId: "english-stage-book" } } },
        ]),
      ),
    );

    const loadBooksMock = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    // @ts-expect-error -- JS module without declarations
    const { createBook } = await import("../../../studio/public/js/forms.js");

    await createBook({ preventDefault } as unknown as Event, loadBooksMock);

    expect(setStatusMock).toHaveBeenCalledWith("Stage: Persisting project files");
  });

  it("surfaces nested create-book errors in the pipeline create flow", async () => {
    const pipelineStages = { innerHTML: "" };
    const pipelineStatus = { textContent: "" };
    const pipelineTitle = { textContent: "" };
    const pipelineForm = { style: { display: "" } };
    const pipelineLight = { setAttribute: vi.fn(), title: "" };
    const pipelineGoto = { style: { display: "none" } };
    const pipelineStreamBtn = { style: { display: "none" } };
    const streamOverlay = { style: { display: "none" }, setAttribute: vi.fn() };
    const streamOverlayBody = { dataset: {}, addEventListener: vi.fn(), setAttribute: vi.fn(), innerHTML: "", scrollHeight: 0, scrollTop: 0, clientHeight: 0 };
    const streamOverlayDiff = { dataset: {}, addEventListener: vi.fn(), setAttribute: vi.fn(), innerHTML: "", scrollHeight: 0, scrollTop: 0, clientHeight: 0, querySelector: vi.fn(() => null) };
    const streamTabContent = { addEventListener: vi.fn(), classList: { toggle: vi.fn() } };
    const streamTabDiff = { addEventListener: vi.fn(), classList: { toggle: vi.fn() } };
    const diffBadge = { classList: { add: vi.fn(), remove: vi.fn() }, textContent: "" };
    const streamOverlayClose = { addEventListener: vi.fn() };
    const streamOverlayCopy = { addEventListener: vi.fn() };
    const pipelineBack = { addEventListener: vi.fn() };
    const pipelineStart = { addEventListener: vi.fn() };

    elements.set("pipeline-stages", pipelineStages as unknown as Record<string, unknown>);
    elements.set("pipeline-status", pipelineStatus as unknown as Record<string, unknown>);
    elements.set("pipeline-title", pipelineTitle as unknown as Record<string, unknown>);
    elements.set("pipeline-form", pipelineForm as unknown as Record<string, unknown>);
    elements.set("pipeline-light", pipelineLight as unknown as Record<string, unknown>);
    elements.set("pipeline-goto", pipelineGoto as unknown as Record<string, unknown>);
    elements.set("pipeline-stream-btn", pipelineStreamBtn as unknown as Record<string, unknown>);
    elements.set("stream-overlay", streamOverlay as unknown as Record<string, unknown>);
    elements.set("stream-overlay-body", streamOverlayBody as unknown as Record<string, unknown>);
    elements.set("stream-overlay-diff", streamOverlayDiff as unknown as Record<string, unknown>);
    elements.set("stream-tab-content", streamTabContent as unknown as Record<string, unknown>);
    elements.set("stream-tab-diff", streamTabDiff as unknown as Record<string, unknown>);
    elements.set("diff-badge", diffBadge as unknown as Record<string, unknown>);
    elements.set("stream-overlay-close", streamOverlayClose as unknown as Record<string, unknown>);
    elements.set("stream-overlay-copy", streamOverlayCopy as unknown as Record<string, unknown>);
    elements.set("pipeline-back", pipelineBack as unknown as Record<string, unknown>);
    elements.set("pipeline-start", pipelineStart as unknown as Record<string, unknown>);

    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => []),
      createElement: () => ({
        className: "",
        id: "",
        innerHTML: "",
        appendChild: vi.fn(),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        closest: vi.fn(() => ({ querySelector: vi.fn(() => null) })),
        addEventListener: vi.fn(),
        classList: { contains: vi.fn(() => false), toggle: vi.fn() },
        scrollIntoView: vi.fn(),
      }),
      getElementById: (id: string) => elements.get(id) ?? null,
    });
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
      cb(0);
      return 0;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        mockSSEResponse([
          { event: "done", data: { ok: false, data: { error: "真实后端错误" } } },
        ]),
      ),
    );

    // @ts-expect-error -- JS module without declarations
    const { openCreatePipeline } = await import("../../../studio/public/js/pipeline.js");

    await openCreatePipeline({ title: "流水线新书", writeFirstChapter: false }, vi.fn());

    expect(pipelineStatus.textContent).toBe("创建失败");
    expect(showToastMock).toHaveBeenCalledWith("真实后端错误", "error");
  });
});
