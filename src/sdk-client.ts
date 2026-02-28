/**
 * Drop-in replacement for Claude Agent SDK with automatic code caching.
 *
 * Simply swap your import:
 *
 *     // Before
 *     import { query } from "@anthropic-ai/claude-agent-sdk";
 *
 *     // After
 *     import { query } from "raysurfer";
 *
 * Everything else works exactly the same. Set RAYSURFER_API_KEY to enable caching.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AccountInfo,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  ModelInfo,
  Options,
  PermissionMode,
  Query,
  RewindFilesResult,
  SDKMessage,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { RaySurfer } from "./client";
import type { CodeFile, FileWritten } from "./types";

const DEFAULT_RAYSURFER_URL = "https://api.raysurfer.com";
const CACHE_DIR = ".raysurfer_code";
const DEFAULT_RUN_PARSE_SAMPLE_RATE = 1;
const RUN_PARSE_SAMPLE_RATE_ENV_VAR = "RAYSURFER_RUN_PARSE_SAMPLE_RATE";
const DEFAULT_AGENT_COMPAT_TOOLS_PRESET = {
  type: "preset" as const,
  preset: "claude_code" as const,
};
const DEFAULT_SANDBOX_SETTINGS = {
  enabled: true,
  autoAllowBashIfSandboxed: true,
};

function resolveRunParseSampleRate(configured?: number): number {
  if (configured !== undefined) {
    if (!Number.isFinite(configured) || configured < 0 || configured > 1) {
      throw new Error(
        `runParseSampleRate must be between 0.0 and 1.0 inclusive; got ${configured}.`,
      );
    }
    return configured;
  }

  const envValue = process.env[RUN_PARSE_SAMPLE_RATE_ENV_VAR];
  if (!envValue || envValue.trim() === "") {
    return DEFAULT_RUN_PARSE_SAMPLE_RATE;
  }

  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(
      `[raysurfer] ${RUN_PARSE_SAMPLE_RATE_ENV_VAR}=${JSON.stringify(envValue)} is invalid. ` +
        `Expected a number between 0.0 and 1.0 inclusive. Falling back to ${DEFAULT_RUN_PARSE_SAMPLE_RATE}.`,
    );
    return DEFAULT_RUN_PARSE_SAMPLE_RATE;
  }

  return parsed;
}

function shouldParseRunForAiVoting(sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return Math.random() < sampleRate;
}

// ---------------------------------------------------------------------------
// Internal message shape interfaces for _trackMessage type safety
// ---------------------------------------------------------------------------

/** Content block within an assistant message */
interface ContentBlock {
  type: string;
  name?: string;
  text?: string;
  content?: string;
  input?: { file_path?: string; notebook_path?: string; command?: string };
}

/** Shape of msg.message on assistant-type SDK messages */
interface AssistantMessagePayload {
  content?: ContentBlock[];
}

/** SDK message with discriminated type/subtype fields used in _trackMessage */
interface TrackedMessage {
  type: string;
  subtype?: string;
  message?: AssistantMessagePayload;
  duration_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
}

// File modification tools to track
const FILE_MODIFY_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

// Trackable file extensions for Bash output
const TRACKABLE_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".ts",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".cpp",
  ".c",
  ".h",
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".md",
  ".txt",
  ".sh",
  ".sql",
]);

// Patterns to detect file outputs in Bash commands
const BASH_OUTPUT_PATTERNS = [
  />>\s*([^\s;&|]+)/g, // append redirect
  />\s*([^\s;&|]+)/g, // redirect
  /-o\s+([^\s;&|]+)/g, // -o flag
  /--output[=\s]+([^\s;&|]+)/g, // --output flag
  /savefig\(['"]([^'"]+)['"]\)/g, // Python savefig
  /to_csv\(['"]([^'"]+)['"]\)/g, // Python to_csv
  /to_excel\(['"]([^'"]+)['"]\)/g, // Python to_excel
  /write\(['"]([^'"]+)['"]\)/g, // Python file write
];

// Debug logger - enabled via RAYSURFER_DEBUG=true or debug option
const createDebugLogger = (enabled: boolean) => ({
  log: (
    ...args: Array<
      | string
      | number
      | boolean
      | null
      | undefined
      | Error
      | Record<string, string | number>
    >
  ) => enabled && console.log("[raysurfer]", ...args),
  time: (label: string) => enabled && console.time(`[raysurfer] ${label}`),
  timeEnd: (label: string) =>
    enabled && console.timeEnd(`[raysurfer] ${label}`),
  table: (data: Array<Record<string, string>>) =>
    enabled && console.table(data),
  group: (label: string) => enabled && console.group(`[raysurfer] ${label}`),
  groupEnd: () => enabled && console.groupEnd(),
});

/** Raysurfer-specific options beyond Claude SDK Options */
export interface RaysurferExtras {
  /** Workspace ID for per-customer isolation (enterprise only) */
  workspaceId?: string;
  /** Include community public snippets (from github-snips) in retrieval results */
  publicSnips?: boolean;
  /** Enable debug logging - also enabled via RAYSURFER_DEBUG=true env var */
  debug?: boolean;
  /** Fraction of runs to parse for AI voting (0.0-1.0). Default is 1.0. */
  runParseSampleRate?: number;
  /** @deprecated Use `cwd` instead */
  workingDirectory?: string;
  /** Agent ID for scoped search and upload attribution */
  agentId?: string;
}

/** Full query options: Claude SDK Options extended with Raysurfer extras */
export type RaysurferQueryOptions = Options & RaysurferExtras;

/**
 * @deprecated Use RaysurferQueryOptions instead
 */
export type QueryOptions = RaysurferQueryOptions;

/** Query parameters - matches Claude Agent SDK */
export interface QueryParams {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: RaysurferQueryOptions;
}

/** Augment a system prompt (string or preset form) with a cache addition */
function augmentSystemPrompt(
  systemPrompt: Options["systemPrompt"],
  addition: string,
): Options["systemPrompt"] {
  if (!addition) return systemPrompt;
  if (typeof systemPrompt === "string") return systemPrompt + addition;
  if (systemPrompt?.type === "preset") {
    return { ...systemPrompt, append: (systemPrompt.append ?? "") + addition };
  }
  return addition;
}

/** Extract raysurfer-specific extras from combined options, returning SDK options and extras separately */
function splitOptions(options: RaysurferQueryOptions): {
  sdkOptions: Options;
  extras: RaysurferExtras;
} {
  const {
    workspaceId,
    publicSnips,
    debug,
    runParseSampleRate,
    workingDirectory,
    agentId,
    ...sdkOptions
  } = options;
  return {
    sdkOptions,
    extras: {
      workspaceId,
      publicSnips,
      debug,
      runParseSampleRate,
      workingDirectory,
      agentId,
    },
  };
}

/** Apply default compatibility tools + sandbox config when callers omit them. */
function applyDefaultAgentCompatibilityOptions(options: Options): Options {
  const merged = { ...options };
  const hasToolsPreset = merged.tools !== undefined && merged.tools !== null;
  const hasAllowedTools =
    Array.isArray(merged.allowedTools) && merged.allowedTools.length > 0;

  if (!hasToolsPreset && !hasAllowedTools) {
    merged.tools = DEFAULT_AGENT_COMPAT_TOOLS_PRESET;
  }

  if (merged.sandbox && typeof merged.sandbox === "object") {
    merged.sandbox = {
      ...DEFAULT_SANDBOX_SETTINGS,
      ...merged.sandbox,
    };
  } else {
    merged.sandbox = { ...DEFAULT_SANDBOX_SETTINGS };
  }

  return merged;
}

/**
 * RaysurferQuery wraps the Claude SDK Query with cache lookup and upload.
 * Implements the Query interface (extends AsyncGenerator<SDKMessage, void>).
 */
class RaysurferQuery {
  private _inner: Query | null = null;
  private _initPromise: Promise<void> | null = null;

  // Cache state
  private _raysurfer: RaySurfer | null = null;
  private _cachedFiles: CodeFile[] = [];
  private _modifiedFilePaths = new Set<string>();
  private _bashGeneratedFiles = new Set<string>();
  private _executionLogs: string[] = [];
  private _taskSucceeded = false;
  private _generatedCodeBlocks: string[] = [];
  private _cacheUploadDone = false;
  private _messageCount = 0;
  private _startTime = 0;

  // Config
  private _promptText: string | null;
  private _params: QueryParams;
  private _debug: ReturnType<typeof createDebugLogger>;
  private _cacheEnabled: boolean;
  private _workDir: string;
  private _apiKey: string | undefined;
  private _baseUrl: string;
  private _extras: RaysurferExtras;
  private _sdkOptions: Options;
  private _runParseSampleRate: number;
  private _parseRunForAiVoting: boolean;

  constructor(params: QueryParams) {
    this._params = params;
    const options = params.options ?? {};
    const { sdkOptions, extras } = splitOptions(options);
    this._sdkOptions = applyDefaultAgentCompatibilityOptions(sdkOptions);
    this._extras = extras;

    // Determine if prompt is a string (cacheable) or stream (not cacheable)
    this._promptText = typeof params.prompt === "string" ? params.prompt : null;

    // Debug logging
    const debugEnabled = extras.debug || process.env.RAYSURFER_DEBUG === "true";
    this._debug = createDebugLogger(debugEnabled);

    // Cache config
    this._apiKey = process.env.RAYSURFER_API_KEY;
    this._baseUrl = process.env.RAYSURFER_BASE_URL || DEFAULT_RAYSURFER_URL;
    this._cacheEnabled = !!this._apiKey;
    this._runParseSampleRate = resolveRunParseSampleRate(
      extras.runParseSampleRate,
    );
    this._parseRunForAiVoting = shouldParseRunForAiVoting(
      this._runParseSampleRate,
    );

    // Working directory: cwd > workingDirectory (deprecated) > process.cwd()
    if (extras.workingDirectory && !sdkOptions.cwd) {
      console.warn(
        "[raysurfer] workingDirectory is deprecated, use cwd instead",
      );
      this._sdkOptions.cwd = extras.workingDirectory;
    }
    this._workDir = this._sdkOptions.cwd || process.cwd();
  }

  private async _initialize(): Promise<void> {
    this._debug.group("Raysurfer Query Started");
    this._debug.log("Prompt:", this._promptText ?? "<stream>");
    this._debug.log("Cache enabled:", this._cacheEnabled);
    this._debug.log("Base URL:", this._baseUrl);
    this._debug.log("Run parse sample rate:", this._runParseSampleRate);
    this._debug.log("Parse this run for AI voting:", this._parseRunForAiVoting);

    if (!this._cacheEnabled) {
      console.warn("[raysurfer] RAYSURFER_API_KEY not set - caching disabled");
    }

    let addToLlmPrompt = "";

    // Cache lookup (only for string prompts)
    if (this._cacheEnabled && this._promptText) {
      // Auto-set snipsDesired="client" when workspaceId is provided
      this._raysurfer = new RaySurfer({
        apiKey: this._apiKey,
        baseUrl: this._baseUrl,
        workspaceId: this._extras.workspaceId,
        snipsDesired: this._extras.workspaceId ? "client" : undefined,
        publicSnips: this._extras.publicSnips,
        agentId: this._extras.agentId,
      });

      try {
        this._debug.time("Cache lookup");
        const cacheDir = join(this._workDir, CACHE_DIR);
        const response = await this._raysurfer.getCodeFiles({
          task: this._promptText,
          topK: 5,
          minVerdictScore: 0.3,
          preferComplete: true,
          perFunctionReputation: true,
          cacheDir,
        });
        this._debug.timeEnd("Cache lookup");
        this._cachedFiles = response.files;
        addToLlmPrompt = response.addToLlmPrompt;

        this._debug.log(`Found ${this._cachedFiles.length} cached files:`);
        console.log(
          "[raysurfer] Cache hit:",
          this._cachedFiles.length,
          "snippets retrieved",
        );

        if (this._cachedFiles.length > 0) {
          this._debug.table(
            this._cachedFiles.map((f) => ({
              filename: f.filename,
              score: `${Math.round(f.score * 100)}%`,
              thumbs: `${f.thumbsUp}/${f.thumbsDown}`,
              sourceLength: `${f.source.length} chars`,
            })),
          );

          // Write cached files to disk so agent can Read them
          try {
            mkdirSync(cacheDir, { recursive: true });
            for (const file of this._cachedFiles) {
              const filePath = join(cacheDir, file.filename);
              writeFileSync(filePath, file.source, "utf-8");
              this._debug.log(`  → Wrote cached file: ${filePath}`);
              this._modifiedFilePaths.add(filePath);
            }
          } catch (writeErr) {
            this._debug.log(
              "Failed to write cached files:",
              writeErr instanceof Error ? writeErr : String(writeErr),
            );
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this._debug.log("Cache lookup failed:", errMsg);
        console.warn("[raysurfer] Cache unavailable:", errMsg);
      }
    }

    // Augment system prompt with cache information
    const augmented = augmentSystemPrompt(
      this._sdkOptions.systemPrompt,
      addToLlmPrompt,
    );
    const augmentedOptions: Options = {
      ...this._sdkOptions,
      systemPrompt: augmented,
    };

    this._debug.log(
      "Augmented prompt addition:",
      addToLlmPrompt.length,
      "chars",
    );

    // Import and create SDK query
    let sdkQueryFn: (args: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Options;
    }) => Query;
    try {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      sdkQueryFn = sdk.query;
    } catch {
      throw new Error(
        "Could not import @anthropic-ai/claude-agent-sdk. " +
          "Install it with: npm install @anthropic-ai/claude-agent-sdk",
      );
    }

    this._debug.time("Claude API call");
    this._debug.log("Calling Claude Agent SDK...");
    this._startTime = Date.now();

    this._inner = sdkQueryFn({
      prompt: this._params.prompt,
      options: augmentedOptions,
    });
  }

  private async _ensureInit(): Promise<Query> {
    if (!this._inner) {
      if (!this._initPromise) {
        this._initPromise = this._initialize();
      }
      await this._initPromise;
    }
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by _initialize
    return this._inner!;
  }

  /** Extract potential output files from Bash commands */
  private _extractBashOutputFiles(command: string): void {
    for (const pattern of BASH_OUTPUT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(command);
      while (match !== null) {
        const filePath = match[1];
        if (filePath && filePath.length > 0) {
          const ext = filePath
            .substring(filePath.lastIndexOf("."))
            .toLowerCase();
          if (TRACKABLE_EXTENSIONS.has(ext)) {
            this._bashGeneratedFiles.add(filePath);
            this._debug.log(`  → Bash output file detected: ${filePath}`);
          }
        }
        match = pattern.exec(command);
      }
    }
  }

  /** Track a message for file modifications and code block extraction */
  private _trackMessage(message: SDKMessage): void {
    this._messageCount++;
    // Cast once to our internal tracked shape for field access
    const msg = message as SDKMessage & TrackedMessage;
    const elapsed = Date.now() - this._startTime;

    this._debug.log(`\n═══════════════════════════════════════════════════`);
    this._debug.log(
      `Message #${this._messageCount} [${elapsed}ms] type=${msg.type} subtype=${msg.subtype ?? "none"}`,
    );
    this._debug.log(`═══════════════════════════════════════════════════`);
    this._debug.log(JSON.stringify(msg, null, 2));

    // Track file modification tool calls AND extract code from text responses
    if (msg.type === "assistant" && msg.message?.content) {
      // Use our ContentBlock shape to access fields the SDK types don't expose
      const blocks = msg.message.content as ContentBlock[];
      for (const block of blocks) {
        // Track file modification tools
        if (
          block.type === "tool_use" &&
          block.name &&
          FILE_MODIFY_TOOLS.includes(block.name)
        ) {
          const filePath = block.input?.file_path ?? block.input?.notebook_path;
          if (filePath) {
            this._debug.log(`  → ${block.name} tool detected:`, filePath);
            this._modifiedFilePaths.add(filePath);
          }
        }

        // Track Bash command file outputs
        if (block.type === "tool_use" && block.name === "Bash") {
          const command = block.input?.command;
          if (command) {
            this._extractBashOutputFiles(command);
          }
        }

        // Capture tool_result content as execution logs
        if (block.type === "tool_result" && block.content) {
          if (this._parseRunForAiVoting) {
            this._executionLogs.push(block.content.slice(0, 5000));
          }
        }

        // Extract code blocks from text responses
        if (block.type === "text" && block.text) {
          const codeMatches = block.text.match(
            /```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)\n?```/g,
          );
          if (codeMatches) {
            for (const match of codeMatches) {
              const code = match
                .replace(/```(?:typescript|javascript|ts|js)?\n?/, "")
                .replace(/\n?```$/, "");
              if (code.trim().length > 50) {
                this._generatedCodeBlocks.push(code.trim());
                this._debug.log(
                  `  → Extracted code block (${code.length} chars)`,
                );
              }
            }
          }
        }
      }
    }

    // Check for successful completion
    if (msg.type === "result" && msg.subtype === "success") {
      this._taskSucceeded = true;
      this._debug.timeEnd("Claude API call");
      this._debug.log("Task succeeded!");
      this._debug.log("  Duration:", msg.duration_ms, "ms");
      this._debug.log("  Total cost:", msg.total_cost_usd, "USD");
      this._debug.log("  Turns:", msg.num_turns);
    }

    if (msg.type === "result" && msg.subtype !== "success") {
      this._debug.timeEnd("Claude API call");
      this._debug.log("Task failed:", msg.subtype);
    }
  }

  /** Upload generated code and trigger voting for cached code blocks */
  private async _uploadCache(): Promise<void> {
    if (this._cacheUploadDone) return;
    this._cacheUploadDone = true;

    this._debug.log("Total messages streamed:", this._messageCount);
    this._debug.log("Modified files tracked:", this._modifiedFilePaths.size);
    this._debug.log("Code blocks extracted:", this._generatedCodeBlocks.length);

    // Read final content of modified files for caching
    const filesToCache: FileWritten[] = [];
    for (const filePath of this._modifiedFilePaths) {
      if (filePath.includes(CACHE_DIR)) {
        this._debug.log("  → Skipping cached file:", filePath);
        continue;
      }

      try {
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf-8");
          if (content.includes("\0")) {
            this._debug.log("  → Skipping binary file:", filePath);
            continue;
          }
          filesToCache.push({ path: filePath, content });
          this._debug.log(
            "  → Will cache file:",
            filePath,
            `(${content.length} chars)`,
          );
        } else {
          this._debug.log("  → File not found:", filePath);
        }
      } catch (err) {
        this._debug.log(
          "  → Failed to read file:",
          filePath,
          err instanceof Error ? err : String(err),
        );
      }
    }

    // Read and cache files generated by Bash commands
    for (const filePath of this._bashGeneratedFiles) {
      if (this._modifiedFilePaths.has(filePath)) continue;
      try {
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf-8");
          if (!content.includes("\0")) {
            filesToCache.push({ path: filePath, content });
            this._debug.log(
              "  → Will cache Bash-generated file:",
              filePath,
              `(${content.length} chars)`,
            );
          }
        }
      } catch {
        this._debug.log("  → Failed to read Bash-generated file:", filePath);
      }
    }

    // Also add extracted code blocks as virtual files
    if (this._generatedCodeBlocks.length > 0) {
      const largestBlock = this._generatedCodeBlocks.reduce((a, b) =>
        a.length > b.length ? a : b,
      );
      filesToCache.push({
        path: "generated-code.ts",
        content: largestBlock,
      });
      this._debug.log(
        "  → Will cache generated code block:",
        `(${largestBlock.length} chars)`,
      );
    }

    this._debug.log("Total items to cache:", filesToCache.length);

    // Upload generated code and trigger voting
    if (
      this._cacheEnabled &&
      this._raysurfer &&
      this._taskSucceeded &&
      this._promptText
    ) {
      const cachedBlocksForVoting = this._parseRunForAiVoting
        ? this._cachedFiles.map((f) => ({
            codeBlockId: f.codeBlockId,
            filename: f.filename,
            description: f.description,
          }))
        : [];

      if (filesToCache.length > 0 || cachedBlocksForVoting.length > 0) {
        try {
          this._debug.time("Cache upload + voting");
          if (!this._parseRunForAiVoting) {
            this._debug.log(
              "Skipping AI voting parse for this run due sampling",
            );
          }
          const joinedLogs =
            this._parseRunForAiVoting && this._executionLogs.length > 0
              ? this._executionLogs.join("\n---\n")
              : undefined;
          this._debug.log(
            "Uploading",
            filesToCache.length,
            "files, voting for",
            cachedBlocksForVoting.length,
            "cached blocks,",
            this._executionLogs.length,
            "log entries...",
          );
          // Upload each file individually (single-file endpoint)
          // Pass cachedCodeBlocks only on the first call to trigger voting once
          for (const [i, file] of filesToCache.entries()) {
            await this._raysurfer.uploadNewCodeSnip({
              task: this._promptText,
              fileWritten: file,
              succeeded: true,
              cachedCodeBlocks:
                i === 0 && cachedBlocksForVoting.length > 0
                  ? cachedBlocksForVoting
                  : undefined,
              useRaysurferAiVoting: this._parseRunForAiVoting,
              executionLogs: joinedLogs,
              perFunctionReputation: true,
            });
          }
          // If no files to upload but there are cached blocks to vote on,
          // still trigger voting via a dummy upload
          if (filesToCache.length === 0 && cachedBlocksForVoting.length > 0) {
            // Vote on cached blocks via the voting API directly
            for (const cb of cachedBlocksForVoting) {
              await this._raysurfer.voteCodeSnip({
                task: this._promptText,
                codeBlockId: cb.codeBlockId,
                codeBlockName: cb.filename,
                codeBlockDescription: cb.description,
                succeeded: true,
              });
            }
          }
          this._debug.timeEnd("Cache upload + voting");
          this._debug.log("Cache upload successful, voting queued on backend");
          console.log(
            "[raysurfer] Cache upload successful:",
            filesToCache.length,
            "files stored",
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this._debug.log("Cache upload failed:", errMsg);
          console.warn("[raysurfer] Cache upload failed:", errMsg);
        }
      }
    }

    this._debug.groupEnd();
  }

  // ===========================================================================
  // AsyncGenerator protocol
  // ===========================================================================

  async next(
    ...args: [] | [unknown]
  ): Promise<IteratorResult<SDKMessage, void>> {
    const inner = await this._ensureInit();
    const result = await inner.next(...args);
    if (!result.done) {
      this._trackMessage(result.value);
    } else {
      await this._uploadCache();
    }
    return result;
  }

  async return(
    value?: void | PromiseLike<void>,
  ): Promise<IteratorResult<SDKMessage, void>> {
    if (this._inner) {
      await this._uploadCache();
      return this._inner.return(value as undefined);
    }
    return { done: true as const, value: undefined as undefined };
  }

  async throw(e?: unknown): Promise<IteratorResult<SDKMessage, void>> {
    if (this._inner) return this._inner.throw(e);
    throw e;
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  // ===========================================================================
  // Query control methods — proxy to underlying SDK Query
  // ===========================================================================

  async interrupt(): Promise<void> {
    return (await this._ensureInit()).interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    return (await this._ensureInit()).setPermissionMode(mode);
  }

  async setModel(model?: string): Promise<void> {
    return (await this._ensureInit()).setModel(model);
  }

  async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
    return (await this._ensureInit()).setMaxThinkingTokens(maxThinkingTokens);
  }

  async supportedCommands(): Promise<SlashCommand[]> {
    return (await this._ensureInit()).supportedCommands();
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return (await this._ensureInit()).supportedModels();
  }

  async mcpServerStatus(): Promise<McpServerStatus[]> {
    return (await this._ensureInit()).mcpServerStatus();
  }

  async accountInfo(): Promise<AccountInfo> {
    return (await this._ensureInit()).accountInfo();
  }

  async rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean },
  ): Promise<RewindFilesResult> {
    return (await this._ensureInit()).rewindFiles(userMessageId, options);
  }

  async setMcpServers(
    servers: Record<string, McpServerConfig>,
  ): Promise<McpSetServersResult> {
    return (await this._ensureInit()).setMcpServers(servers);
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    return (await this._ensureInit()).streamInput(stream);
  }

  close(): void {
    if (this._inner) this._inner.close();
  }
}

/**
 * Drop-in replacement for Claude Agent SDK's query function with automatic caching.
 *
 * Usage is identical to the original:
 *
 *     import { query } from "raysurfer";
 *
 *     for await (const message of query({ prompt: "Hello" })) {
 *       console.log(message);
 *     }
 *
 * Set RAYSURFER_API_KEY environment variable to enable caching.
 */
export function query(params: QueryParams): Query {
  return new RaysurferQuery(params) as Query;
}

/**
 * ClaudeSDKClient - Class-based drop-in replacement.
 *
 * For users who prefer the Python-style class interface:
 *
 *     const client = new ClaudeSDKClient(options);
 *     for await (const msg of client.query("Hello")) {
 *       console.log(msg);
 *     }
 */
export class ClaudeSDKClient {
  private options: RaysurferQueryOptions;

  constructor(options: RaysurferQueryOptions = {}) {
    this.options = options;
  }

  query(prompt: string | AsyncIterable<SDKUserMessage>): Query {
    return query({ prompt, options: this.options });
  }
}

// Backwards compatibility aliases
export { ClaudeSDKClient as RaysurferClient };
export type { RaysurferQueryOptions as RaysurferAgentOptions };

export default query;
