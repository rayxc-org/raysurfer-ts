/**
 * Helpers for Anthropic programmatic tool calling with materialized Raysurfer snippets.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import type { RaySurfer } from "./client";
import type {
  CodeFile,
  FileWritten,
  SearchMatch,
  SubmitExecutionResultResponse,
} from "./types";

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_VERDICT_SCORE = 0.3;

export interface ProgrammaticToolCallingSessionOptions {
  topK?: number;
  workspaceId?: string;
  tempdir?: string;
  minVerdictScore?: number;
  preferComplete?: boolean;
}

export interface ProgrammaticPrepareTurnOptions {
  firstMessage?: boolean;
}

export interface ProgrammaticUploadOptions {
  succeeded?: boolean;
  executionLogs?: string;
  useRaysurferAiVoting?: boolean;
}

export interface ProgrammaticMaterializeContext {
  tempdir: string;
  contextPrompt: string;
  files: CodeFile[];
  topK: number;
  workspaceId?: string;
}

function validateTopK(topK: number): number {
  if (topK < 1) {
    throw new Error(
      `Invalid topK value: ${topK}. Expected format: positive integer >= 1. ` +
        "Current tier/state: tier=unknown, top_k_invalid=true. " +
        "Fix: pass topK=1 or higher.",
    );
  }
  return topK;
}

function toCodeFiles(matches: SearchMatch[]): CodeFile[] {
  return matches.map((match) => ({
    codeBlockId: match.codeBlock.id,
    filename: match.filename,
    source: match.codeBlock.source,
    entrypoint: match.entrypoint,
    description: match.codeBlock.description,
    inputSchema: match.codeBlock.inputSchema,
    outputSchema: match.codeBlock.outputSchema,
    language: match.language,
    dependencies: match.dependencies,
    score: match.score,
    thumbsUp: match.thumbsUp,
    thumbsDown: match.thumbsDown,
  }));
}

function normalizePathForPrompt(path: string): string {
  return path.split(sep).join("/");
}

function formatContextPrompt(files: CodeFile[], cacheDir: string): string {
  if (files.length === 0) return "";

  const lines: string[] = [
    "\n\n## IMPORTANT: Pre-validated Code Files Available\n",
    "The following validated code has been retrieved from the cache. " +
      "Use these files directly instead of regenerating code.\n",
  ];

  for (const file of files) {
    const fullPath = normalizePathForPrompt(resolve(cacheDir, file.filename));
    lines.push(`\n### \`${file.filename}\` -> \`${fullPath}\``);
    lines.push(`- **Description**: ${file.description}`);
    lines.push(`- **Language**: ${file.language}`);
    lines.push(`- **Entrypoint**: \`${file.entrypoint}\``);
    lines.push(`- **Confidence**: ${Math.round(file.score * 100)}%`);
    const deps = Object.entries(file.dependencies);
    if (deps.length > 0) {
      lines.push(
        `- **Dependencies**: ${deps.map(([name, version]) => `${name}@${version}`).join(", ")}`,
      );
    }
  }

  lines.push("\n\n**Instructions**:");
  lines.push("1. Read the cached file(s) before writing new code");
  lines.push("2. Use the cached code as your starting point");
  lines.push("3. Only modify if the task requires specific changes");
  lines.push("4. Do not regenerate code that already exists\n");

  return lines.join("\n");
}

function resolveSafeTarget(baseDir: string, relativePath: string): string {
  const resolvedBase = resolve(baseDir);
  const target = resolve(resolvedBase, relativePath);
  if (target !== resolvedBase && !target.startsWith(`${resolvedBase}${sep}`)) {
    throw new Error(
      `Invalid snippet filename: ${JSON.stringify(relativePath)}. ` +
        `Expected format: relative path inside ${resolvedBase}. ` +
        "Current tier/state: tier=unknown, path_outside_tempdir=true. " +
        "Fix: use relative snippet filenames.",
    );
  }
  return target;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, {
      withFileTypes: true,
      encoding: "utf8",
    });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listFilesRecursive(fullPath)));
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    return files;
  }
  return files.sort();
}

async function readUtf8Text(path: string): Promise<string | null> {
  const raw = await readFile(path);
  if (raw.includes(0)) return null;
  return raw.toString("utf-8");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function snapshotHashes(tempdir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const files = await listFilesRecursive(tempdir);
  const resolvedTempdir = resolve(tempdir);
  for (const path of files) {
    const content = await readUtf8Text(path);
    if (content === null) continue;
    const relativePath = normalizePathForPrompt(
      relative(resolvedTempdir, path),
    );
    snapshot.set(relativePath, hashContent(content));
  }
  return snapshot;
}

async function collectChangedFiles(
  tempdir: string,
  baselineHashes: Map<string, string>,
): Promise<{
  changedFiles: FileWritten[];
  currentHashes: Map<string, string>;
}> {
  const changedFiles: FileWritten[] = [];
  const currentHashes = new Map<string, string>();
  const files = await listFilesRecursive(tempdir);
  const resolvedTempdir = resolve(tempdir);
  for (const path of files) {
    const content = await readUtf8Text(path);
    if (content === null) continue;
    const relativePath = normalizePathForPrompt(
      relative(resolvedTempdir, path),
    );
    const contentHash = hashContent(content);
    currentHashes.set(relativePath, contentHash);
    if (baselineHashes.get(relativePath) !== contentHash) {
      changedFiles.push({ path: relativePath, content });
    }
  }
  return { changedFiles, currentHashes };
}

export class ProgrammaticToolCallingSession {
  private readonly client: RaySurfer;
  private readonly topK: number;
  private readonly workspaceId?: string;
  private readonly tempdir: string;
  private readonly ownsTempdir: boolean;
  private readonly minVerdictScore: number;
  private readonly preferComplete: boolean;
  private baselineHashes = new Map<string, string>();
  private contextPrompt = "";
  private files: CodeFile[] = [];
  private executionLogs: string[] = [];
  private prepared = false;

  constructor(
    client: RaySurfer,
    options: ProgrammaticToolCallingSessionOptions = {},
  ) {
    this.client = client;
    this.topK = validateTopK(options.topK ?? DEFAULT_TOP_K);
    this.workspaceId = options.workspaceId;
    this.minVerdictScore = options.minVerdictScore ?? DEFAULT_MIN_VERDICT_SCORE;
    this.preferComplete = options.preferComplete ?? true;
    this.ownsTempdir = options.tempdir === undefined;
    this.tempdir =
      options.tempdir ?? resolve(tmpdir(), `raysurfer_ptc_${randomUUID()}`);
  }

  getTempdir(): string {
    return this.tempdir;
  }

  appendLog(logLine: string): void {
    if (logLine.trim().length > 0) {
      this.executionLogs.push(logLine);
    }
  }

  async prepareTurn(
    task: string,
    options: ProgrammaticPrepareTurnOptions = {},
  ): Promise<ProgrammaticMaterializeContext> {
    const firstMessage = options.firstMessage ?? true;
    await mkdir(this.tempdir, { recursive: true });

    if (firstMessage) {
      const response = await this.client.search({
        task,
        topK: this.topK,
        minVerdictScore: this.minVerdictScore,
        preferComplete: this.preferComplete,
        workspaceId: this.workspaceId,
      });
      this.files = toCodeFiles(response.matches);
      for (const file of this.files) {
        const target = resolveSafeTarget(this.tempdir, file.filename);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.source, "utf-8");
      }
      this.contextPrompt = formatContextPrompt(this.files, this.tempdir);
      this.baselineHashes = await snapshotHashes(this.tempdir);
      this.prepared = true;
    } else if (!this.prepared) {
      this.baselineHashes = await snapshotHashes(this.tempdir);
      this.prepared = true;
    }

    return {
      tempdir: this.tempdir,
      contextPrompt: this.contextPrompt,
      files: [...this.files],
      topK: this.topK,
      workspaceId: this.workspaceId,
    };
  }

  async uploadChangedCode(
    task: string,
    options: ProgrammaticUploadOptions = {},
  ): Promise<SubmitExecutionResultResponse | null> {
    const { changedFiles, currentHashes } = await collectChangedFiles(
      this.tempdir,
      this.baselineHashes,
    );
    if (changedFiles.length === 0) {
      this.baselineHashes = currentHashes;
      return null;
    }

    const logs =
      options.executionLogs ??
      (this.executionLogs.length > 0
        ? this.executionLogs.join("\n---\n")
        : undefined);

    const response = await this.client.upload({
      task,
      filesWritten: changedFiles,
      succeeded: options.succeeded ?? true,
      useRaysurferAiVoting: options.useRaysurferAiVoting ?? true,
      executionLogs: logs,
      workspaceId: this.workspaceId,
    });

    this.baselineHashes = currentHashes;
    this.executionLogs = [];
    return response;
  }

  async cleanup(options: { removeTempdir?: boolean } = {}): Promise<void> {
    if (options.removeTempdir && this.ownsTempdir) {
      await rm(this.tempdir, { recursive: true, force: true });
    }
  }
}
