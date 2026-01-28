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
import { RaySurfer } from "./client";
import type { CodeFile, FileWritten, SnipsDesired } from "./types";

const DEFAULT_RAYSURFER_URL = "https://web-production-3d338.up.railway.app";
const CACHE_DIR = ".raysurfer_code";

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
  log: (...args: unknown[]) => enabled && console.log("[raysurfer]", ...args),
  time: (label: string) => enabled && console.time(`[raysurfer] ${label}`),
  timeEnd: (label: string) =>
    enabled && console.timeEnd(`[raysurfer] ${label}`),
  table: (data: unknown) => enabled && console.table(data),
  group: (label: string) => enabled && console.group(`[raysurfer] ${label}`),
  groupEnd: () => enabled && console.groupEnd(),
});

/** Options for the query function - matches Claude Agent SDK */
export interface QueryOptions {
  model?: string;
  workingDirectory?: string;
  systemPrompt?: string;
  permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  maxBudgetUsd?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  env?: Record<string, string>;
  /** Whether to include public/shared snippets in retrieval (default: false) */
  publicSnips?: boolean;
  /** Scope of private snippets - "company" (Team/Enterprise) or "client" (Enterprise only) */
  snipsDesired?: SnipsDesired;
  /** Custom namespace for code storage/retrieval */
  namespace?: string;
  /** Enable debug logging - also enabled via RAYSURFER_DEBUG=true env var */
  debug?: boolean;
  /** Path to Claude Code executable (required for SDK) */
  pathToClaudeCodeExecutable?: string;
  /** Allow dangerous permissions bypass */
  allowDangerouslySkipPermissions?: boolean;
}

/** Query parameters - matches Claude Agent SDK */
export interface QueryParams {
  prompt: string;
  options?: QueryOptions;
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
export async function* query(params: QueryParams): AsyncGenerator<unknown> {
  const { prompt, options = {} } = params;

  // Initialize debug logger
  const debugEnabled = options.debug || process.env.RAYSURFER_DEBUG === "true";
  const debug = createDebugLogger(debugEnabled);

  debug.group("Raysurfer Query Started");
  debug.log("Prompt:", prompt);
  debug.log("Options:", {
    ...options,
    systemPrompt: options.systemPrompt || undefined,
  });

  // Check if caching should be enabled
  const apiKey = process.env.RAYSURFER_API_KEY;
  const baseUrl = process.env.RAYSURFER_BASE_URL || DEFAULT_RAYSURFER_URL;
  const cacheEnabled = !!apiKey;
  if (!cacheEnabled) {
    console.warn("[raysurfer] RAYSURFER_API_KEY not set - caching disabled");
  }

  debug.log("Cache enabled:", cacheEnabled);
  debug.log("Base URL:", baseUrl);

  let raysurfer: RaySurfer | null = null;
  let cachedFiles: CodeFile[] = [];
  const modifiedFilePaths = new Set<string>();
  const bashGeneratedFiles = new Set<string>();
  let taskSucceeded = false;

  /** Extract potential output files from Bash commands */
  const extractBashOutputFiles = (command: string): void => {
    for (const pattern of BASH_OUTPUT_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(command);
      while (match !== null) {
        const filePath = match[1];
        if (filePath && filePath.length > 0) {
          const ext = filePath
            .substring(filePath.lastIndexOf("."))
            .toLowerCase();
          if (TRACKABLE_EXTENSIONS.has(ext)) {
            bashGeneratedFiles.add(filePath);
            debug.log(`  → Bash output file detected: ${filePath}`);
          }
        }
        match = pattern.exec(command);
      }
    }
  };

  // Working directory for the session
  const workDir = options.workingDirectory || process.cwd();

  // Retrieve cached code if enabled
  let addToLlmPrompt = "";
  if (cacheEnabled) {
    raysurfer = new RaySurfer({
      apiKey,
      baseUrl,
      publicSnips: options.publicSnips,
      snipsDesired: options.snipsDesired,
      namespace: options.namespace,
    });
    try {
      debug.time("Cache lookup");
      const cacheDir = join(workDir, CACHE_DIR);
      const response = await raysurfer.getCodeFiles({
        task: prompt,
        topK: 5,
        minVerdictScore: 0.3, // Low bar - return best matches we have
        preferComplete: true,
        cacheDir, // Pass cacheDir to get full paths in addToLlmPrompt
      });
      debug.timeEnd("Cache lookup");
      cachedFiles = response.files;
      addToLlmPrompt = response.addToLlmPrompt; // Use the pre-formatted prompt

      debug.log(`Found ${cachedFiles.length} cached files:`);
      console.log(
        "[raysurfer] Cache hit:",
        cachedFiles.length,
        "snippets retrieved",
      );
      if (cachedFiles.length > 0) {
        debug.table(
          cachedFiles.map((f) => ({
            filename: f.filename,
            similarity: `${Math.round(f.similarityScore * 100)}%`,
            verdict: `${Math.round(f.verdictScore * 100)}%`,
            combined: `${Math.round(f.combinedScore * 100)}%`,
            thumbs: `${f.thumbsUp}/${f.thumbsDown}`,
            sourceLength: `${f.source.length} chars`,
          })),
        );

        // Write cached files to disk so agent can Read them
        try {
          mkdirSync(cacheDir, { recursive: true });
          for (const file of cachedFiles) {
            const filePath = join(cacheDir, file.filename);
            writeFileSync(filePath, file.source, "utf-8");
            debug.log(`  → Wrote cached file: ${filePath}`);
            // Track cached files as part of sandbox
            modifiedFilePaths.add(filePath);
          }
        } catch (writeErr) {
          debug.log("Failed to write cached files:", writeErr);
        }
      }
    } catch (error) {
      debug.log("Cache lookup failed:", error);
      console.warn(
        "[raysurfer] Cache unavailable:",
        error instanceof Error ? error.message : error,
      );
      // Fail silently - agent can still work without cache
    }
  }

  // Build augmented system prompt using addToLlmPrompt from the API response
  const augmentedPrompt = (options.systemPrompt ?? "") + addToLlmPrompt;
  debug.log(
    "System prompt length:",
    options.systemPrompt?.length ?? 0,
    "chars",
  );
  debug.log("Augmented prompt length:", augmentedPrompt.length, "chars");
  debug.log("Added from cache:", addToLlmPrompt.length, "chars");
  if (addToLlmPrompt) {
    debug.log("\n--- AUGMENTED PROMPT ADDITION ---");
    debug.log(addToLlmPrompt);
    debug.log("--- END AUGMENTED PROMPT ---\n");
  }

  // Import and use Claude Agent SDK
  let sdkQuery: (args: QueryParams) => AsyncIterable<unknown>;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    sdkQuery = sdk.query;
  } catch {
    throw new Error(
      "Could not import @anthropic-ai/claude-agent-sdk. " +
        "Install it with: npm install @anthropic-ai/claude-agent-sdk",
    );
  }

  // Query with augmented prompt
  debug.time("Claude API call");
  debug.log("Calling Claude Agent SDK...");
  const response = sdkQuery({
    prompt,
    options: {
      ...options,
      systemPrompt: augmentedPrompt,
    },
  });

  // Stream responses and track modified files + generated code
  let messageCount = 0;
  const startTime = Date.now();
  const generatedCodeBlocks: string[] = []; // Track code from text responses

  for await (const message of response) {
    messageCount++;
    const msg = message as Record<string, unknown>;
    const elapsed = Date.now() - startTime;

    // Full message logging with timestamp
    debug.log(`\n═══════════════════════════════════════════════════`);
    debug.log(
      `Message #${messageCount} [${elapsed}ms] type=${msg.type} subtype=${msg.subtype || "none"}`,
    );
    debug.log(`═══════════════════════════════════════════════════`);
    debug.log(JSON.stringify(msg, null, 2));

    // Track file modification tool calls AND extract code from text responses
    if (msg.type === "assistant") {
      const content = msg.message as Record<string, unknown> | undefined;
      const contentBlocks = content?.content as
        | Array<Record<string, unknown>>
        | undefined;
      if (contentBlocks) {
        for (const block of contentBlocks) {
          // Track file modification tools
          if (
            block.type === "tool_use" &&
            FILE_MODIFY_TOOLS.includes(block.name as string)
          ) {
            const input = block.input as Record<string, unknown> | undefined;
            // Handle both file_path (Edit, Write) and notebook_path (NotebookEdit)
            const filePath = (input?.file_path ?? input?.notebook_path) as
              | string
              | undefined;
            if (filePath) {
              debug.log(`  → ${block.name} tool detected:`, filePath);
              modifiedFilePaths.add(filePath);
            }
          }

          // Track Bash command file outputs
          if (block.type === "tool_use" && block.name === "Bash") {
            const input = block.input as Record<string, unknown> | undefined;
            const command = input?.command as string | undefined;
            if (command) {
              extractBashOutputFiles(command);
            }
          }

          // Extract code blocks from text responses
          if (block.type === "text") {
            const text = block.text as string;
            const codeMatches = text.match(
              /```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)\n?```/g,
            );
            if (codeMatches) {
              for (const match of codeMatches) {
                // Extract just the code (remove the backticks and language identifier)
                const code = match
                  .replace(/```(?:typescript|javascript|ts|js)?\n?/, "")
                  .replace(/\n?```$/, "");
                if (code.trim().length > 50) {
                  // Only meaningful code blocks
                  generatedCodeBlocks.push(code.trim());
                  debug.log(`  → Extracted code block (${code.length} chars)`);
                }
              }
            }
          }
        }
      }
    }

    // Check for successful completion
    if (msg.type === "result" && msg.subtype === "success") {
      taskSucceeded = true;
      debug.timeEnd("Claude API call");
      debug.log("Task succeeded!");
      const result = msg as Record<string, unknown>;
      debug.log("  Duration:", result.duration_ms, "ms");
      debug.log("  Total cost:", result.total_cost_usd, "USD");
      debug.log("  Turns:", result.num_turns);
    }

    if (msg.type === "result" && msg.subtype !== "success") {
      debug.timeEnd("Claude API call");
      debug.log("Task failed:", msg.subtype);
    }

    yield message;
  }

  debug.log("Total messages streamed:", messageCount);
  debug.log("Modified files tracked:", modifiedFilePaths.size);
  debug.log("Code blocks extracted:", generatedCodeBlocks.length);

  // Read final content of modified files for caching
  const filesToCache: FileWritten[] = [];
  for (const filePath of modifiedFilePaths) {
    // Skip cache dir files (those are pulled, not generated)
    if (filePath.includes(CACHE_DIR)) {
      debug.log("  → Skipping cached file:", filePath);
      continue;
    }

    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        // Skip binary files (contain null bytes)
        if (content.includes("\0")) {
          debug.log("  → Skipping binary file:", filePath);
          continue;
        }
        filesToCache.push({ path: filePath, content });
        debug.log(
          "  → Will cache file:",
          filePath,
          `(${content.length} chars)`,
        );
      } else {
        debug.log("  → File not found:", filePath);
      }
    } catch (err) {
      debug.log("  → Failed to read file:", filePath, err);
    }
  }

  // Read and cache files generated by Bash commands
  for (const filePath of bashGeneratedFiles) {
    // Skip if already tracked via tool calls
    if (modifiedFilePaths.has(filePath)) continue;

    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        // Skip binary files
        if (!content.includes("\0")) {
          filesToCache.push({ path: filePath, content });
          debug.log(
            "  → Will cache Bash-generated file:",
            filePath,
            `(${content.length} chars)`,
          );
        }
      }
    } catch {
      debug.log("  → Failed to read Bash-generated file:", filePath);
    }
  }

  // Also add extracted code blocks as virtual files
  if (generatedCodeBlocks.length > 0) {
    // Use the largest code block (most likely to be the main generated code)
    const largestBlock = generatedCodeBlocks.reduce((a, b) =>
      a.length > b.length ? a : b,
    );
    filesToCache.push({
      path: "generated-code.ts",
      content: largestBlock,
    });
    debug.log(
      "  → Will cache generated code block:",
      `(${largestBlock.length} chars)`,
    );
  }

  debug.log("Total items to cache:", filesToCache.length);

  // Upload generated code and trigger voting for cached code blocks (backend handles voting)
  if (cacheEnabled && raysurfer && taskSucceeded) {
    // Prepare cached code block info for backend voting
    const cachedBlocksForVoting = cachedFiles.map((f) => ({
      codeBlockId: f.codeBlockId,
      filename: f.filename,
      description: f.description,
    }));

    if (filesToCache.length > 0 || cachedBlocksForVoting.length > 0) {
      try {
        debug.time("Cache upload + voting");
        debug.log(
          "Uploading",
          filesToCache.length,
          "files, voting for",
          cachedBlocksForVoting.length,
          "cached blocks...",
        );
        await raysurfer.uploadNewCodeSnips(
          prompt,
          filesToCache,
          true,
          cachedBlocksForVoting.length > 0 ? cachedBlocksForVoting : undefined,
        );
        debug.timeEnd("Cache upload + voting");
        debug.log("Cache upload successful, voting queued on backend");
        console.log(
          "[raysurfer] Cache upload successful:",
          filesToCache.length,
          "files stored",
        );
      } catch (error) {
        debug.log("Cache upload failed:", error);
        console.warn(
          "[raysurfer] Cache upload failed:",
          error instanceof Error ? error.message : error,
        );
        // Fail silently
      }
    }
  }

  debug.groupEnd();
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
  private options: QueryOptions;

  constructor(options: QueryOptions = {}) {
    this.options = options;
  }

  async *query(prompt: string): AsyncGenerator<unknown> {
    yield* query({ prompt, options: this.options });
  }
}

// Alias for backwards compatibility
export { ClaudeSDKClient as RaysurferClient };
export type { QueryOptions as RaysurferAgentOptions };

export default query;
