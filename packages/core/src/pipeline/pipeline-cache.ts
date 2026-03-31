/**
 * Pipeline checkpoint cache for resumable chapter writing.
 *
 * Saves LLM stage outputs to story/.pipeline-cache/chapter-XXXX/
 * so that a failed pipeline run can resume from the last successful stage
 * without re-burning LLM tokens.
 */

import { readFile, writeFile, mkdir, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ── Stage names ──

export type PipelineStageName =
  | "write"
  | "postwrite-fix"
  | "normalize-preaudit"
  | "audit-initial"
  | "revise"
  | "normalize-postrevise"
  | "audit-final"
  | "settle";

export type StageStatus = "pending" | "completed" | "skipped";

const ALL_STAGES: readonly PipelineStageName[] = [
  "write",
  "postwrite-fix",
  "normalize-preaudit",
  "audit-initial",
  "revise",
  "normalize-postrevise",
  "audit-final",
  "settle",
];

// ── Stage manifest ──

export interface StageEntry {
  status: StageStatus;
  reason?: string;
}

export interface StageManifest {
  version: 1;
  bookId: string;
  chapterNumber: number;
  inputFingerprint: string;
  status: "running" | "finalizing";
  finalizeStatus: "pending" | "in_progress" | "completed";
  stages: Record<PipelineStageName, StageEntry>;
  skipLengthNormalization: boolean;
  startedAt: string;
  updatedAt: string;
}

// ── Fingerprint ──

export interface FingerprintInput {
  bookId: string;
  chapterNumber: number;
  wordCount: number | undefined;
  temperatureOverride: number | undefined;
  skipLengthNormalization: boolean;
  bookDir: string;
}

// ── PipelineCache class ──

export class PipelineCache {
  private readonly cacheDir: string;
  private readonly storyDir: string;
  private manifest: StageManifest | null = null;

  constructor(storyDir: string, chapterNumber: number) {
    this.storyDir = storyDir;
    this.cacheDir = join(storyDir, ".pipeline-cache", `chapter-${String(chapterNumber).padStart(4, "0")}`);
  }

  get dir(): string {
    return this.cacheDir;
  }

  // ── Lifecycle ──

  /**
   * Try to load an existing cache. Returns true if a valid cache exists.
   */
  async tryLoad(): Promise<boolean> {
    try {
      const raw = await readFile(join(this.cacheDir, "stage.json"), "utf-8");
      this.manifest = JSON.parse(raw) as StageManifest;
      return true;
    } catch {
      this.manifest = null;
      return false;
    }
  }

  /**
   * Initialize a fresh cache for a new pipeline run.
   */
  async init(params: {
    bookId: string;
    chapterNumber: number;
    inputFingerprint: string;
    skipLengthNormalization: boolean;
  }): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });

    const stages: Record<PipelineStageName, StageEntry> = {} as Record<PipelineStageName, StageEntry>;
    for (const name of ALL_STAGES) {
      stages[name] = { status: "pending" };
    }

    this.manifest = {
      version: 1,
      bookId: params.bookId,
      chapterNumber: params.chapterNumber,
      inputFingerprint: params.inputFingerprint,
      status: "running",
      finalizeStatus: "pending",
      stages,
      skipLengthNormalization: params.skipLengthNormalization,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveManifest();
  }

  /**
   * Check if the fingerprint matches. If not, move cache to _stale/.
   */
  async validateFingerprint(currentFingerprint: string): Promise<boolean> {
    if (!this.manifest) return false;
    if (this.manifest.inputFingerprint === currentFingerprint) return true;

    // Fingerprint mismatch — stale cache
    const staleDir = join(this.storyDir, ".pipeline-cache", "_stale", `chapter-${String(this.manifest.chapterNumber).padStart(4, "0")}-${Date.now()}`);
    await mkdir(join(this.storyDir, ".pipeline-cache", "_stale"), { recursive: true });
    await rename(this.cacheDir, staleDir);
    this.manifest = null;
    return false;
  }

  // ── Stage operations ──

  /**
   * Check if a stage is already completed (has cached output).
   */
  isStageCompleted(stage: PipelineStageName): boolean {
    return this.manifest?.stages[stage]?.status === "completed";
  }

  /**
   * Check if a stage is skipped.
   */
  isStageSkipped(stage: PipelineStageName): boolean {
    return this.manifest?.stages[stage]?.status === "skipped";
  }

  /**
   * Check if a stage should be executed (not completed, not skipped).
   */
  shouldRunStage(stage: PipelineStageName): boolean {
    if (!this.manifest) return true;
    const entry = this.manifest.stages[stage];
    return entry.status === "pending";
  }

  /**
   * Read cached output for a completed stage.
   */
  async readStageOutput<T>(stage: PipelineStageName): Promise<T> {
    const filePath = join(this.cacheDir, `${stage}-output.json`);
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  }

  /**
   * Write stage output and mark as completed.
   */
  async completeStage<T>(stage: PipelineStageName, output: T, reason?: string): Promise<void> {
    if (!this.manifest) return;

    // Atomic write: tmp + rename
    const filePath = join(this.cacheDir, `${stage}-output.json`);
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(output, null, 2), "utf-8");
    await rename(tmpPath, filePath);

    this.manifest.stages[stage] = { status: "completed", reason };
    this.manifest.updatedAt = new Date().toISOString();
    await this.saveManifest();
  }

  /**
   * Mark a stage as skipped.
   */
  async skipStage(stage: PipelineStageName, reason: string): Promise<void> {
    if (!this.manifest) return;
    this.manifest.stages[stage] = { status: "skipped", reason };
    this.manifest.updatedAt = new Date().toISOString();
    await this.saveManifest();
  }

  // ── Finalize lifecycle ──

  async markFinalizing(): Promise<void> {
    if (!this.manifest) return;
    this.manifest.status = "finalizing";
    this.manifest.finalizeStatus = "in_progress";
    this.manifest.updatedAt = new Date().toISOString();
    await this.saveManifest();
  }

  async markFinalizeCompleted(): Promise<void> {
    if (!this.manifest) return;
    this.manifest.finalizeStatus = "completed";
    this.manifest.updatedAt = new Date().toISOString();
    await this.saveManifest();
  }

  get finalizeStatus(): string {
    return this.manifest?.finalizeStatus ?? "pending";
  }

  get isSettleCompleted(): boolean {
    return this.isStageCompleted("settle");
  }

  /**
   * Delete the cache directory after successful completion.
   */
  async cleanup(): Promise<void> {
    try {
      await rm(this.cacheDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
    this.manifest = null;
  }

  // ── Fingerprint computation ──

  static async computeFingerprint(params: FingerprintInput): Promise<string> {
    const hash = createHash("sha256");

    // Content hash for critical files
    for (const file of ["book.json", join("story", "current_state.md")]) {
      try {
        const content = await readFile(join(params.bookDir, file), "utf-8");
        hash.update(`content:${file}:${content}\n`);
      } catch {
        hash.update(`content:${file}:MISSING\n`);
      }
    }

    // mtime for other truth files
    const mtimeFiles = [
      "particle_ledger.md", "pending_hooks.md", "story_bible.md",
      "volume_outline.md", "book_rules.md", "author_intent.md", "current_focus.md",
    ];
    for (const file of mtimeFiles) {
      try {
        const s = await stat(join(params.bookDir, "story", file));
        hash.update(`mtime:${file}:${s.mtimeMs}\n`);
      } catch {
        hash.update(`mtime:${file}:MISSING\n`);
      }
    }

    // Call parameters
    hash.update(`params:${params.bookId}:${params.chapterNumber}:${params.wordCount ?? "default"}:${params.temperatureOverride ?? "default"}:${params.skipLengthNormalization}\n`);

    return hash.digest("hex").slice(0, 16);
  }

  // ── Internals ──

  private async saveManifest(): Promise<void> {
    const filePath = join(this.cacheDir, "stage.json");
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(this.manifest, null, 2), "utf-8");
    await rename(tmpPath, filePath);
  }
}
