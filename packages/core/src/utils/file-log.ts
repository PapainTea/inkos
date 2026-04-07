import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createJsonLineSink, type LogSink } from "./logger.js";

export type PipelineOperation = "write" | "rewrite" | "revise" | "spotfix" | "reaudit";

export interface FileLogSession {
  readonly sink: LogSink;
  readonly stream: WriteStream;
  readonly filePath: string;
  readonly close: () => Promise<void>;
}

/**
 * Create a JSONL file log session for a single pipeline operation.
 *
 * - Automatically creates the logs/ directory if missing.
 * - Prunes old log files to keep at most `keep` entries before creating a new one.
 * - The caller MUST call close() in a finally block.
 */
export async function createFileLogSession(
  logDir: string,
  chapterNumber: number,
  operation: PipelineOperation,
  keep = 10,
): Promise<FileLogSession> {
  await mkdir(logDir, { recursive: true });
  await pruneOldLogs(logDir, keep - 1);

  const paddedChapter = String(chapterNumber).padStart(4, "0");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "").slice(0, 15);
  const fileName = `chapter-${paddedChapter}-${operation}-${timestamp}.jsonl`;
  const filePath = join(logDir, fileName);

  // Ensure file exists before opening stream (createWriteStream may defer on some Node versions)
  await writeFile(filePath, "", { flag: "wx" }).catch(() => {});
  const stream = createWriteStream(filePath, { flags: "a", encoding: "utf-8" });
  const sink = createJsonLineSink(stream);

  return {
    sink,
    stream,
    filePath,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (stream.destroyed || stream.closed) {
          resolve();
          return;
        }
        stream.end(() => resolve());
        stream.on("error", reject);
      }),
  };
}

/**
 * Remove oldest .jsonl files in `logDir`, keeping at most `keep` entries.
 */
export async function pruneOldLogs(logDir: string, keep = 10): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(logDir);
  } catch {
    return; // directory doesn't exist yet
  }

  const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length < keep) return;

  // Sort by mtime ascending (oldest first)
  const withMtime = await Promise.all(
    jsonlFiles.map(async (f) => {
      const s = await stat(join(logDir, f)).catch(() => null);
      return { name: f, mtime: s?.mtimeMs ?? 0 };
    }),
  );
  withMtime.sort((a, b) => a.mtime - b.mtime);

  const toDelete = withMtime.slice(0, withMtime.length - keep);
  await Promise.all(
    toDelete.map((f) => unlink(join(logDir, f.name)).catch(() => {})),
  );
}
