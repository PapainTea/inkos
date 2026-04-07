import { describe, expect, it } from "vitest";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileLogSession, pruneOldLogs } from "../utils/file-log.js";

describe("file-log", () => {
  it("creates logs directory and generates correctly named JSONL file", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");

    try {
      const session = await createFileLogSession(logDir, 4, "write");

      expect(session.filePath).toContain("chapter-0004-write-");
      expect(session.filePath.endsWith(".jsonl")).toBe(true);

      // Verify directory was created
      const entries = await readdir(logDir);
      expect(entries.length).toBe(1);
      expect(entries[0]).toMatch(/^chapter-0004-write-\d{8}T\d{6}\.jsonl$/);

      await session.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes valid JSONL through the sink", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");

    try {
      const session = await createFileLogSession(logDir, 1, "spotfix");

      session.sink.write({
        level: "info",
        tag: "test",
        message: "hello",
        timestamp: "2026-04-07T00:00:00.000Z",
      });
      session.sink.write({
        level: "error",
        tag: "test",
        message: "oops",
        timestamp: "2026-04-07T00:00:01.000Z",
        ctx: { code: "EISDIR" },
      });

      await session.close();

      const content = await readFile(session.filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]!)).toEqual(
        expect.objectContaining({ level: "info", message: "hello" }),
      );
      expect(JSON.parse(lines[1]!)).toEqual(
        expect.objectContaining({ level: "error", message: "oops", ctx: { code: "EISDIR" } }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes old logs keeping only the most recent N files", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");
    await mkdir(logDir, { recursive: true });

    try {
      // Create 12 fake log files with staggered mtimes
      for (let i = 1; i <= 12; i++) {
        const name = `chapter-0001-write-20260407T${String(i).padStart(6, "0")}.jsonl`;
        await writeFile(join(logDir, name), `{"i":${i}}\n`, "utf-8");
        // Stagger mtime by touching with slight delay
        const fakeTime = new Date(2026, 3, 7, 0, 0, i);
        const { utimes } = await import("node:fs/promises");
        await utimes(join(logDir, name), fakeTime, fakeTime);
      }

      await pruneOldLogs(logDir, 10);

      const remaining = await readdir(logDir);
      expect(remaining.length).toBe(10);
      // Oldest files (i=1,2) should be deleted, newest 10 remain
      expect(remaining).not.toContain("chapter-0001-write-20260407T000001.jsonl");
      expect(remaining).not.toContain("chapter-0001-write-20260407T000002.jsonl");
      // The rest should still exist
      expect(remaining).toContain("chapter-0001-write-20260407T000003.jsonl");
      expect(remaining).toContain("chapter-0001-write-20260407T000012.jsonl");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not prune when fewer than keep files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");
    await mkdir(logDir, { recursive: true });

    try {
      for (let i = 1; i <= 5; i++) {
        await writeFile(join(logDir, `log-${i}.jsonl`), "", "utf-8");
      }

      await pruneOldLogs(logDir, 10);

      const remaining = await readdir(logDir);
      expect(remaining.length).toBe(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("close() resolves even if stream is already closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");

    try {
      const session = await createFileLogSession(logDir, 2, "reaudit");
      await session.close();
      // Double close should not throw
      await session.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports all operation types in filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");

    try {
      const ops = ["write", "rewrite", "revise", "spotfix", "reaudit"] as const;
      for (const op of ops) {
        const session = await createFileLogSession(logDir, 1, op);
        expect(session.filePath).toContain(`-${op}-`);
        await session.close();
      }

      const entries = await readdir(logDir);
      expect(entries.length).toBe(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes before creating new file when at limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-log-test-"));
    const logDir = join(root, "logs");
    await mkdir(logDir, { recursive: true });

    try {
      // Fill to exactly 10
      for (let i = 1; i <= 10; i++) {
        const name = `chapter-0001-write-20260407T${String(i).padStart(6, "0")}.jsonl`;
        await writeFile(join(logDir, name), "", "utf-8");
        const fakeTime = new Date(2026, 3, 7, 0, 0, i);
        const { utimes } = await import("node:fs/promises");
        await utimes(join(logDir, name), fakeTime, fakeTime);
      }

      // Create new session — should prune oldest first, then add new file
      const session = await createFileLogSession(logDir, 5, "spotfix");
      await session.close();

      const entries = await readdir(logDir);
      expect(entries.length).toBe(10);
      // New file exists
      expect(entries.some((e) => e.includes("chapter-0005-spotfix-"))).toBe(true);
      // Oldest file was pruned
      expect(entries).not.toContain("chapter-0001-write-20260407T000001.jsonl");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
