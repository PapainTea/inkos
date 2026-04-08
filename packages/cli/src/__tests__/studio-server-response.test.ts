import { describe, expect, it } from "vitest";

describe("studio server command response normalization", () => {
  it("promotes data.error to top-level error for failed JSON command output", async () => {
    const helperModulePath = "../../../studio/server-command-response.cjs";
    const { buildCommandResponse } = await import(helperModulePath);

    const response = buildCommandResponse({
      code: 1,
      stdout: JSON.stringify({ error: "Book \"-\" already exists" }),
      stderr: "",
    });

    expect(response.ok).toBe(false);
    expect(response.error).toBe("Book \"-\" already exists");
    expect(response.data).toEqual({ error: "Book \"-\" already exists" });
  });

  it("keeps successful JSON command output unchanged", async () => {
    const helperModulePath = "../../../studio/server-command-response.cjs";
    const { buildCommandResponse } = await import(helperModulePath);

    const response = buildCommandResponse({
      code: 0,
      stdout: JSON.stringify({ bookId: "demo-book" }),
      stderr: "",
    });

    expect(response.ok).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.data).toEqual({ bookId: "demo-book" });
  });
});
