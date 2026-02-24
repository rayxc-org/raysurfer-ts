/**
 * RaySurfer SDK client
 */

import {
  APIError,
  AuthenticationError,
  CacheUnavailableError,
  RateLimitError,
} from "./errors";

export const VERSION = "1.2.1";

import type {
  AgentReview,
  AgentVerdict,
  AlternativeCandidate,
  AutoReviewParams,
  AutoReviewResponse,
  BestMatch,
  BrowsePublicParams,
  BrowsePublicResponse,
  BulkExecutionResultResponse,
  CodeBlock,
  CodeFile,
  DeleteResponse,
  ExecuteOptions,
  ExecuteResult,
  ExecutionState,
  FewShotExample,
  FileWritten,
  GetCodeFilesResponse,
  GetExecutionsParams,
  JsonValue,
  LogFile,
  RetrieveBestResponse,
  RetrieveCodeBlockResponse,
  RetrieveExecutionsResponse,
  SearchPublicParams,
  SearchPublicResponse,
  SearchResponse,
  SnipsDesired,
  StoreCodeBlockResponse,
  StoreExecutionResponse,
  SubmitExecutionResultResponse,
  TaskPattern,
  ToolCallback,
  ToolCallRecord,
  ToolDefinition,
} from "./types";

/** Raw snake_case shape returned by the API for code blocks */
interface RawCodeBlockData {
  id: string;
  name: string;
  description: string;
  source: string;
  entrypoint: string;
  input_schema?: Record<string, JsonValue>;
  output_schema?: Record<string, JsonValue>;
  language: string;
  language_version?: string | null;
  dependencies?: string[] | Record<string, string>;
  tags?: string[];
  capabilities?: string[];
  example_queries?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  agent_id?: string | null;
}

const DEFAULT_BASE_URL = "https://api.raysurfer.com";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 500;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Normalize dependencies from list format (legacy) to dict format (new).
 * Handles both old ["pkg1", "pkg2"] and new {"pkg1": "1.0", "pkg2": "2.0"} formats.
 */
function normalizeDependencies(
  rawDeps: string[] | Record<string, string> | undefined,
): Record<string, string> {
  if (!rawDeps) return {};
  if (Array.isArray(rawDeps)) {
    // Legacy format: ["pandas", "numpy"] -> {"pandas": "", "numpy": ""}
    const result: Record<string, string> = {};
    for (const pkg of rawDeps) {
      result[pkg] = "";
    }
    return result;
  }
  return rawDeps;
}

export interface RaySurferOptions {
  /** RaySurfer API key */
  apiKey?: string;
  /** API base URL */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Organization ID for dedicated namespace (team/enterprise tier) */
  organizationId?: string;
  /** Workspace ID for client-specific namespace (enterprise tier only) */
  workspaceId?: string;
  /** Scope of private snippets - "company" (Team/Enterprise) or "client" (Enterprise only) */
  snipsDesired?: SnipsDesired;
  /** Include community public snippets (from github-snips) in retrieval results */
  publicSnips?: boolean;
  /** Agent ID for scoped search and upload attribution */
  agentId?: string;
}

export interface StoreCodeBlockParams {
  name: string;
  source: string;
  entrypoint: string;
  language: string;
  description?: string;
  inputSchema?: Record<string, JsonValue>;
  outputSchema?: Record<string, JsonValue>;
  languageVersion?: string;
  dependencies?: string[];
  tags?: string[];
  capabilities?: string[];
  exampleQueries?: string[];
}

export interface StoreExecutionParams {
  codeBlockId: string;
  triggeringTask: string;
  inputData: Record<string, JsonValue>;
  outputData: JsonValue;
  executionState?: ExecutionState;
  durationMs?: number;
  errorMessage?: string;
  errorType?: string;
  verdict?: AgentVerdict;
  review?: AgentReview;
}

export interface RetrieveParams {
  task: string;
  topK?: number;
  minVerdictScore?: number;
}

interface UploadNewCodeSnipCompatOptions {
  task: string;
  fileWritten?: FileWritten;
  filesWritten?: FileWritten[];
  succeeded: boolean;
  cachedCodeBlocks?: Array<{
    codeBlockId: string;
    filename: string;
    description: string;
  }>;
  useRaysurferAiVoting?: boolean;
  autoVote?: boolean;
  userVote?: number;
  executionLogs?: string;
  runUrl?: string;
  workspaceId?: string;
  dependencies?: Record<string, string>;
  tags?: string[];
  public?: boolean;
  voteSource?: "ai" | "human";
  voteCount?: number;
}

interface FunctionRegistrySchema {
  name: string;
  description: string;
  source: string;
  codeBlockId?: string;
}

interface AgentRegistryFunction {
  _raysurferAccessible?: boolean;
  _raysurferSchema?: FunctionRegistrySchema;
  _raysurferClient?: RaySurfer;
}

export interface GetCodeFilesParams {
  task: string;
  topK?: number;
  minVerdictScore?: number;
  preferComplete?: boolean;
  /** Directory path where files will be written (default: .raysurfer_code). Used to generate full paths in addToLlmPrompt. */
  cacheDir?: string;
}

export interface GetTaskPatternsParams {
  task?: string;
  codeBlockId?: string;
  minThumbsUp?: number;
  topK?: number;
}

export interface SearchParams {
  task: string;
  topK?: number;
  minVerdictScore?: number;
  /** Minimum number of human upvotes required */
  minHumanUpvotes?: number;
  preferComplete?: boolean;
  inputSchema?: Record<string, JsonValue>;
  /** Override client-level workspaceId for this request */
  workspaceId?: string;
}

/**
 * Async client for RaySurfer API
 */
export class RaySurfer {
  private apiKey?: string;
  private baseUrl: string;
  private timeout: number;
  private organizationId?: string;
  private workspaceId?: string;
  private snipsDesired?: SnipsDesired;
  private publicSnips?: boolean;
  private agentId?: string;
  private registeredTools: Map<
    string,
    { definition: ToolDefinition; callback: ToolCallback }
  >;

  constructor(options: RaySurferOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = options.timeout ?? 60000;
    this.organizationId = options.organizationId;
    this.workspaceId = options.workspaceId;
    this.snipsDesired = options.snipsDesired;
    this.publicSnips = options.publicSnips;
    this.agentId = options.agentId;
    this.registeredTools = new Map();
  }

  private async request<
    T,
    B extends Record<
      string,
      string | number | boolean | null | undefined | object
    > = Record<string, string | number | boolean | null | undefined | object>,
  >(
    method: string,
    path: string,
    body?: B,
    headersOverride?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    // Add organization/workspace headers for namespace routing
    if (this.organizationId) {
      headers["X-Raysurfer-Org-Id"] = this.organizationId;
    }
    if (this.workspaceId) {
      headers["X-Raysurfer-Workspace-Id"] = this.workspaceId;
    }
    // Add snippet retrieval scope headers
    if (this.snipsDesired) {
      headers["X-Raysurfer-Snips-Desired"] = this.snipsDesired;
    }
    // Include community public snippets in retrieval
    if (this.publicSnips) {
      headers["X-Raysurfer-Public-Snips"] = "true";
    }
    // Agent ID for scoped search and upload attribution
    if (this.agentId) {
      headers["X-Raysurfer-Agent-Id"] = this.agentId;
    }
    // SDK version for tracking
    headers["X-Raysurfer-SDK-Version"] = `typescript/${VERSION}`;

    // Apply per-request header overrides (e.g., workspace_id)
    if (headersOverride) {
      Object.assign(headers, headersOverride);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        // Auth errors are not retryable
        if (response.status === 401) {
          throw new AuthenticationError();
        }

        // Handle retryable status codes
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          const text = await response.text();

          if (response.status === 429) {
            const retryAfterHeader = response.headers.get("Retry-After");
            const retryAfterMs = retryAfterHeader
              ? parseFloat(retryAfterHeader) * 1000
              : RETRY_BASE_DELAY * 2 ** attempt;

            if (attempt < MAX_RETRIES) {
              await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
              continue;
            }
            throw new RateLimitError(
              text,
              retryAfterHeader ? parseFloat(retryAfterHeader) : undefined,
            );
          }

          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_DELAY * 2 ** attempt;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw new CacheUnavailableError(text, response.status);
        }

        if (!response.ok) {
          const text = await response.text();
          throw new APIError(text, response.status);
        }

        return (await response.json()) as T;
      } catch (error) {
        // Retry on network errors (TypeError from fetch)
        if (error instanceof TypeError && attempt < MAX_RETRIES) {
          lastError = error;
          const delay = RETRY_BASE_DELAY * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Re-throw non-retryable errors immediately
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError ?? new APIError("Request failed after retries");
  }

  /** Build header overrides for per-request workspaceId */
  private workspaceHeaders(
    workspaceId?: string,
  ): Record<string, string> | undefined {
    if (!workspaceId) return undefined;
    return { "X-Raysurfer-Workspace-Id": workspaceId };
  }

  // =========================================================================
  // Store API
  // =========================================================================

  /** Store a new code block */
  async storeCodeBlock(
    params: StoreCodeBlockParams,
  ): Promise<StoreCodeBlockResponse> {
    const data = {
      name: params.name,
      description: params.description ?? "",
      source: params.source,
      entrypoint: params.entrypoint,
      language: params.language,
      input_schema: params.inputSchema ?? {},
      output_schema: params.outputSchema ?? {},
      language_version: params.languageVersion ?? null,
      dependencies: params.dependencies ?? {},
      tags: params.tags ?? [],
      capabilities: params.capabilities ?? [],
      example_queries: params.exampleQueries ?? null,
    };

    const result = await this.request<{
      success: boolean;
      code_block_id: string;
      embedding_id: string;
      message: string;
    }>("POST", "/api/store/code-block", data);

    return {
      success: result.success,
      codeBlockId: result.code_block_id,
      embeddingId: result.embedding_id,
      message: result.message,
    };
  }

  /** Store an execution record */
  async storeExecution(
    params: StoreExecutionParams,
  ): Promise<StoreExecutionResponse> {
    const io = {
      input_data: params.inputData,
      input_hash: "",
      output_data: params.outputData,
      output_hash: "",
      output_type: typeof params.outputData,
    };

    const data = {
      code_block_id: params.codeBlockId,
      triggering_task: params.triggeringTask,
      io,
      execution_state: params.executionState ?? "completed",
      duration_ms: params.durationMs ?? 0,
      error_message: params.errorMessage ?? null,
      error_type: params.errorType ?? null,
      verdict: params.verdict ?? null,
      review: params.review ?? null,
    };

    const result = await this.request<{
      success: boolean;
      execution_id: string;
      pattern_updated: boolean;
      message: string;
    }>("POST", "/api/store/execution", data);

    return {
      success: result.success,
      executionId: result.execution_id,
      patternUpdated: result.pattern_updated,
      message: result.message,
    };
  }

  /**
   * Upload a single code file from an execution result.
   *
   * This is the simplified API for agent integrations. Just send:
   * - The task that was executed
   * - The file that was written during execution
   * - Whether the task succeeded
   * - (Optional) Cached code blocks that were retrieved and used
   *
   * Backend handles: entrypoint detection, tag extraction, language detection,
   * deduplication, quality checks, storage, AND voting for cached code blocks.
   *
   * For uploading multiple files at once, use uploadBulkCodeSnips().
   */
  async upload(
    taskOrOptions: string | UploadNewCodeSnipCompatOptions,
    fileWritten?: FileWritten,
    succeeded?: boolean,
    cachedCodeBlocks?: Array<{
      codeBlockId: string;
      filename: string;
      description: string;
    }>,
    useRaysurferAiVoting: boolean = true,
    userVote?: number,
    executionLogs?: string,
    runUrl?: string,
    workspaceId?: string,
    dependencies?: Record<string, string>,
    voteSource?: "ai" | "human",
    voteCount?: number,
  ): Promise<SubmitExecutionResultResponse> {
    // Support both positional args (legacy) and options object (new)
    let opts: UploadNewCodeSnipCompatOptions;

    if (typeof taskOrOptions === "object") {
      opts = taskOrOptions;
    } else {
      opts = {
        task: taskOrOptions,
        fileWritten: fileWritten!,
        succeeded: succeeded!,
        cachedCodeBlocks,
        useRaysurferAiVoting,
        userVote,
        executionLogs,
        runUrl,
        workspaceId,
        dependencies,
        voteSource,
        voteCount,
      };
    }

    if (opts.fileWritten && opts.filesWritten) {
      throw new Error("Provide either fileWritten or filesWritten, not both.");
    }

    const effectiveVoting = opts.autoVote ?? opts.useRaysurferAiVoting ?? true;

    const normalizedFiles: FileWritten[] = [];
    if (opts.fileWritten) {
      normalizedFiles.push(opts.fileWritten);
    } else if (opts.filesWritten) {
      normalizedFiles.push(...opts.filesWritten);
    }

    if (normalizedFiles.length === 0) {
      throw new Error(
        "Missing required file input: provide fileWritten or filesWritten.",
      );
    }

    if (normalizedFiles.length > 1) {
      const responses: SubmitExecutionResultResponse[] = [];
      for (const compatFile of normalizedFiles) {
        responses.push(
          await this.upload({
            ...opts,
            fileWritten: compatFile,
            filesWritten: undefined,
            useRaysurferAiVoting: effectiveVoting,
            autoVote: undefined,
          }),
        );
      }

      return {
        success: responses.every((response) => response.success),
        codeBlocksStored: responses.reduce(
          (sum, response) => sum + response.codeBlocksStored,
          0,
        ),
        message: `Uploaded ${normalizedFiles.length} files via compatibility path.`,
      };
    }

    const [resolvedFile] = normalizedFiles;
    const data = {
      task: opts.task,
      file_written: resolvedFile,
      succeeded: opts.succeeded,
      use_raysurfer_ai_voting: effectiveVoting,
      user_vote: opts.userVote,
      execution_logs: opts.executionLogs,
      cached_code_blocks:
        opts.cachedCodeBlocks && opts.cachedCodeBlocks.length > 0
          ? opts.cachedCodeBlocks.map((cb) => ({
              code_block_id: cb.codeBlockId,
              filename: cb.filename,
              description: cb.description,
            }))
          : undefined,
      run_url: opts.runUrl,
      dependencies: opts.dependencies,
      tags: opts.tags,
      public: opts.public || undefined,
      vote_source: opts.voteSource,
      vote_count: opts.voteCount,
    };

    const result = await this.request<{
      success: boolean;
      code_blocks_stored: number;
      message: string;
      snippet_name?: string | null;
    }>(
      "POST",
      "/api/store/execution-result",
      data,
      this.workspaceHeaders(opts.workspaceId),
    );

    return {
      success: result.success,
      codeBlocksStored: result.code_blocks_stored,
      message: result.message,
      snippetName: result.snippet_name ?? null,
    };
  }

  /** Backwards-compatible alias. */
  uploadNewCodeSnip = this.upload.bind(this);

  /** Backwards-compatible alias. */
  uploadNewCodeSnips = this.upload.bind(this);

  /**
   * Delete a snippet and all its associated data.
   * @param snippetId - The ID or name of the snippet to delete.
   */
  async delete(
    snippetId: string,
    options?: { workspaceId?: string },
  ): Promise<DeleteResponse> {
    const result = await this.request<{
      success: boolean;
      deleted_count: number;
      message: string;
    }>(
      "POST",
      "/api/snippets/delete",
      { snippet_id: snippetId },
      this.workspaceHeaders(options?.workspaceId),
    );

    return {
      success: result.success,
      deletedCount: result.deleted_count,
      message: result.message,
    };
  }

  /**
   * Bulk upload code files, prompts, and logs for sandboxed grading.
   *
   * The backend runs a grader that votes thumbs up/down for each code file.
   *
   * Supports both options object (new) and positional arguments (legacy):
   * - Options: `uploadBulkCodeSnips({ prompts, filesWritten, logFiles, ... })`
   * - Legacy: `uploadBulkCodeSnips(prompts, filesWritten, logFiles, ...)`
   */
  async uploadBulkCodeSnips(
    promptsOrOptions:
      | string[]
      | {
          prompts: string[];
          filesWritten: FileWritten[];
          logFiles?: Array<
            | LogFile
            | {
                path: string;
                content: string | Buffer;
                encoding?: "utf-8" | "base64";
                contentType?: string;
              }
          >;
          useRaysurferAiVoting?: boolean;
          userVotes?: Record<string, number>;
          workspaceId?: string;
          voteSource?: "ai" | "human";
          voteCount?: number;
        },
    filesWritten?: FileWritten[],
    logFiles?: Array<
      | LogFile
      | {
          path: string;
          content: string | Buffer;
          encoding?: "utf-8" | "base64";
          contentType?: string;
        }
    >,
    useRaysurferAiVoting: boolean = true,
    userVotes?: Record<string, number>,
    workspaceId?: string,
    voteSource?: "ai" | "human",
    voteCount?: number,
  ): Promise<BulkExecutionResultResponse> {
    // Support both positional args (legacy) and options object (new)
    let opts: {
      prompts: string[];
      filesWritten: FileWritten[];
      logFiles?: Array<
        | LogFile
        | {
            path: string;
            content: string | Buffer;
            encoding?: "utf-8" | "base64";
            contentType?: string;
          }
      >;
      useRaysurferAiVoting?: boolean;
      userVotes?: Record<string, number>;
      workspaceId?: string;
      voteSource?: "ai" | "human";
      voteCount?: number;
    };

    if (!Array.isArray(promptsOrOptions)) {
      opts = promptsOrOptions;
    } else {
      opts = {
        prompts: promptsOrOptions,
        filesWritten: filesWritten!,
        logFiles,
        useRaysurferAiVoting,
        userVotes,
        workspaceId,
        voteSource,
        voteCount,
      };
    }

    const normalizedLogs =
      opts.logFiles?.map((log) => {
        const content =
          typeof log.content === "string"
            ? log.content
            : Buffer.from(log.content).toString("base64");
        const encoding =
          typeof log.content === "string"
            ? (log.encoding ?? "utf-8")
            : "base64";
        return {
          path: log.path,
          content,
          encoding,
          content_type: log.contentType,
        };
      }) ?? [];

    const data = {
      prompts: opts.prompts,
      files_written: opts.filesWritten,
      log_files: normalizedLogs.length > 0 ? normalizedLogs : undefined,
      use_raysurfer_ai_voting: opts.useRaysurferAiVoting ?? true,
      user_votes: opts.userVotes,
      vote_source: opts.voteSource,
      vote_count: opts.voteCount,
    };

    const result = await this.request<{
      success: boolean;
      code_blocks_stored: number;
      votes_queued: number;
      message: string;
      status_url?: string | null;
    }>(
      "POST",
      "/api/store/bulk-execution-result",
      data,
      this.workspaceHeaders(opts.workspaceId),
    );

    return {
      success: result.success,
      codeBlocksStored: result.code_blocks_stored,
      votesQueued: result.votes_queued,
      message: result.message,
      statusUrl: result.status_url ?? null,
    };
  }

  // =========================================================================
  // Retrieve API
  // =========================================================================

  async search(params: SearchParams): Promise<SearchResponse> {
    /** Unified search across all cached code using POST /api/retrieve/search. */
    const data = {
      task: params.task,
      top_k: params.topK ?? 5,
      min_verdict_score: params.minVerdictScore ?? 0.3,
      min_human_upvotes: params.minHumanUpvotes ?? 0,
      prefer_complete: params.preferComplete ?? false,
      input_schema: params.inputSchema ?? null,
    };

    const result = await this.request<{
      matches: Array<{
        code_block: RawCodeBlockData;
        score: number;
        vector_score?: number;
        verdict_score?: number;
        thumbs_up: number;
        thumbs_down: number;
        filename: string;
        language: string;
        entrypoint: string;
        dependencies: string[] | Record<string, string>;
        agent_id?: string | null;
        comments?: Record<string, JsonValue>[];
      }>;
      total_found: number;
      cache_hit: boolean;
    }>(
      "POST",
      "/api/retrieve/search",
      data,
      this.workspaceHeaders(params.workspaceId),
    );

    return {
      matches: result.matches.map((m) => {
        const vectorScore = m.vector_score ?? m.score;
        const verdictScore = m.verdict_score ?? m.score;
        return {
          codeBlock: this.parseCodeBlock(m.code_block),
          score: m.score,
          combinedScore: m.score,
          vectorScore,
          verdictScore,
          thumbsUp: m.thumbs_up,
          thumbsDown: m.thumbs_down,
          filename: m.filename,
          language: m.language,
          entrypoint: m.entrypoint,
          dependencies: normalizeDependencies(m.dependencies),
          agentId: m.agent_id ?? null,
          comments: m.comments ?? [],
        };
      }),
      totalFound: result.total_found,
      cacheHit: result.cache_hit,
    };
  }

  /** Get cached code snippets for a task (semantic search) */
  async getCodeSnips(
    params: RetrieveParams,
  ): Promise<RetrieveCodeBlockResponse> {
    /** Delegates to unified search() and maps results to legacy CodeBlockMatch format. */
    const response = await this.search({
      task: params.task,
      topK: params.topK ?? 10,
      minVerdictScore: params.minVerdictScore ?? 0.0,
    });
    return {
      codeBlocks: response.matches.map((m) => ({
        codeBlock: m.codeBlock,
        score: m.score,
        thumbsUp: m.thumbsUp,
        thumbsDown: m.thumbsDown,
        recentExecutions: [],
      })),
      totalFound: response.totalFound,
    };
  }

  /** Get the single best code block for a task using verdict-aware scoring */
  async retrieveBest(params: RetrieveParams): Promise<RetrieveBestResponse> {
    /** Delegates to unified search() and maps results to legacy RetrieveBestResponse format. */
    const response = await this.search({
      task: params.task,
      topK: params.topK ?? 10,
      minVerdictScore: params.minVerdictScore ?? 0.0,
    });
    let bestMatch: BestMatch | null = null;
    let bestScore = 0;
    const first = response.matches[0];
    if (first) {
      bestMatch = {
        codeBlock: first.codeBlock,
        score: first.score,
        thumbsUp: first.thumbsUp,
        thumbsDown: first.thumbsDown,
      };
      bestScore = first.score;
    }
    const alternativeCandidates: AlternativeCandidate[] = response.matches
      .slice(1, 4)
      .map((m) => ({
        codeBlockId: m.codeBlock.id,
        name: m.codeBlock.name,
        score: m.score,
        reason:
          m.thumbsUp > 0
            ? `${m.thumbsUp} thumbs up, ${m.thumbsDown} thumbs down`
            : "No execution history",
      }));
    return {
      bestMatch,
      alternativeCandidates,
      retrievalConfidence: bestMatch ? String(bestScore.toFixed(4)) : "0",
    };
  }

  /** Retrieve few-shot examples for code generation */
  async getFewShotExamples(task: string, k = 3): Promise<FewShotExample[]> {
    const data = { task, k };

    const result = await this.request<{
      examples: Array<{
        task: string;
        input_sample: Record<string, JsonValue>;
        output_sample: JsonValue;
        code_snippet: string;
      }>;
    }>("POST", "/api/retrieve/few-shot-examples", data);

    return result.examples.map((ex) => ({
      task: ex.task,
      inputSample: ex.input_sample,
      outputSample: ex.output_sample,
      codeSnippet: ex.code_snippet,
    }));
  }

  /** Retrieve proven task->code mappings */
  async getTaskPatterns(params: GetTaskPatternsParams): Promise<TaskPattern[]> {
    const data = {
      task: params.task ?? null,
      code_block_id: params.codeBlockId ?? null,
      min_thumbs_up: params.minThumbsUp ?? 0,
      top_k: params.topK ?? 20,
    };

    const result = await this.request<{
      patterns: Array<{
        task_pattern: string;
        code_block_id: string;
        code_block_name: string;
        thumbs_up: number;
        thumbs_down: number;
        last_thumbs_up?: string | null;
        last_thumbs_down?: string | null;
      }>;
    }>("POST", "/api/retrieve/task-patterns", data);

    return result.patterns.map((p) => ({
      taskPattern: p.task_pattern,
      codeBlockId: p.code_block_id,
      codeBlockName: p.code_block_name,
      thumbsUp: p.thumbs_up,
      thumbsDown: p.thumbs_down,
      lastThumbsUp: p.last_thumbs_up,
      lastThumbsDown: p.last_thumbs_down,
    }));
  }

  async getCodeFiles(
    params: GetCodeFilesParams,
  ): Promise<GetCodeFilesResponse> {
    /**
     * Get code files for a task, ready to download to sandbox.
     * Delegates to unified search() and maps results to CodeFile format.
     */
    const response = await this.search({
      task: params.task,
      topK: params.topK ?? 5,
      minVerdictScore: params.minVerdictScore ?? 0.3,
      preferComplete: params.preferComplete ?? true,
    });
    const files: CodeFile[] = response.matches.map((m) => ({
      codeBlockId: m.codeBlock.id,
      filename: m.filename,
      source: m.codeBlock.source,
      entrypoint: m.entrypoint,
      description: m.codeBlock.description,
      inputSchema: m.codeBlock.inputSchema,
      outputSchema: m.codeBlock.outputSchema,
      language: m.language,
      dependencies: m.dependencies,
      score: m.score,
      thumbsUp: m.thumbsUp,
      thumbsDown: m.thumbsDown,
    }));
    const addToLlmPrompt = this.formatLlmPrompt(
      files,
      params.cacheDir ?? ".raysurfer_code",
    );
    return {
      files,
      task: params.task,
      totalFound: response.totalFound,
      addToLlmPrompt,
    };
  }

  /**
   * Format a prompt string listing all retrieved code files.
   * @internal
   */
  private formatLlmPrompt(files: CodeFile[], cacheDir?: string): string {
    if (files.length === 0) return "";

    const lines: string[] = [
      "\n\n## IMPORTANT: Pre-validated Code Files Available\n",
      "The following validated code has been retrieved from the cache. " +
        "Use these files directly instead of regenerating code.\n",
    ];

    for (const f of files) {
      if (cacheDir) {
        const fullPath = `${cacheDir}/${f.filename}`;
        lines.push(`\n### \`${f.filename}\` → \`${fullPath}\``);
      } else {
        lines.push(`\n### \`${f.filename}\``);
      }
      lines.push(`- **Description**: ${f.description}`);
      lines.push(`- **Language**: ${f.language}`);
      lines.push(`- **Entrypoint**: \`${f.entrypoint}\``);
      lines.push(`- **Confidence**: ${Math.round(f.score * 100)}%`);
      const deps = Object.entries(f.dependencies);
      if (deps.length > 0) {
        lines.push(
          `- **Dependencies**: ${deps.map(([k, v]) => `${k}@${v}`).join(", ")}`,
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

  // =========================================================================
  // Auto Review API
  // =========================================================================

  /**
   * Get an auto-generated review using Claude Opus 4.6.
   * Useful for programmatically reviewing execution results.
   */
  async autoReview(params: AutoReviewParams): Promise<AutoReviewResponse> {
    const response = await this.request<{
      success: boolean;
      execution_id: string;
      review: {
        timestamp: string;
        verdict: AgentVerdict;
        reasoning: string;
        what_worked: string[];
        what_didnt_work: string[];
        output_was_useful: boolean;
        output_was_correct: boolean;
        output_was_complete: boolean;
        error_was_appropriate: boolean | null;
        would_use_again: boolean;
        suggested_improvements: string[];
        required_workaround: boolean;
        workaround_description: string | null;
      };
      message: string;
    }>("POST", "/api/store/auto-review", {
      execution_id: params.executionId,
      triggering_task: params.triggeringTask,
      execution_state: params.executionState,
      input_data: params.inputData,
      output_data: params.outputData,
      code_block_name: params.codeBlockName,
      code_block_description: params.codeBlockDescription,
      error_message: params.errorMessage,
    });

    return {
      success: response.success,
      executionId: response.execution_id,
      review: {
        timestamp: response.review.timestamp,
        verdict: response.review.verdict,
        reasoning: response.review.reasoning,
        whatWorked: response.review.what_worked,
        whatDidntWork: response.review.what_didnt_work,
        outputWasUseful: response.review.output_was_useful,
        outputWasCorrect: response.review.output_was_correct,
        outputWasComplete: response.review.output_was_complete,
        errorWasAppropriate: response.review.error_was_appropriate,
        wouldUseAgain: response.review.would_use_again,
        suggestedImprovements: response.review.suggested_improvements,
        requiredWorkaround: response.review.required_workaround,
        workaroundDescription: response.review.workaround_description,
      },
      message: response.message,
    };
  }

  /**
   * Retrieve execution records by code block ID, task, or verdict.
   */
  async getExecutions(
    params: GetExecutionsParams = {},
  ): Promise<RetrieveExecutionsResponse> {
    const response = await this.request<{
      executions: Array<{
        id: string;
        code_block_id: string;
        timestamp: string;
        execution_state: ExecutionState;
        duration_ms: number;
        error_message: string | null;
        error_type: string | null;
        io: {
          input_data: Record<string, JsonValue>;
          input_hash: string;
          output_data: JsonValue;
          output_hash: string;
          output_type: string;
        };
        triggering_task: string;
        retrieval_score: number;
        verdict: AgentVerdict;
        review: {
          timestamp: string;
          verdict: AgentVerdict;
          reasoning: string;
          what_worked: string[];
          what_didnt_work: string[];
          output_was_useful: boolean;
          output_was_correct: boolean;
          output_was_complete: boolean;
          error_was_appropriate: boolean | null;
          would_use_again: boolean;
          suggested_improvements: string[];
          required_workaround: boolean;
          workaround_description: string | null;
        } | null;
      }>;
      total_found: number;
    }>("POST", "/api/retrieve/executions", {
      code_block_id: params.codeBlockId,
      task: params.task,
      verdict: params.verdict,
      limit: params.limit ?? 20,
    });

    return {
      executions: response.executions.map((exec) => ({
        id: exec.id,
        codeBlockId: exec.code_block_id,
        timestamp: exec.timestamp,
        executionState: exec.execution_state,
        durationMs: exec.duration_ms,
        errorMessage: exec.error_message,
        errorType: exec.error_type,
        io: {
          inputData: exec.io.input_data,
          inputHash: exec.io.input_hash,
          outputData: exec.io.output_data,
          outputHash: exec.io.output_hash,
          outputType: exec.io.output_type,
        },
        triggeringTask: exec.triggering_task,
        retrievalScore: exec.retrieval_score,
        verdict: exec.verdict,
        review: exec.review
          ? {
              timestamp: exec.review.timestamp,
              verdict: exec.review.verdict,
              reasoning: exec.review.reasoning,
              whatWorked: exec.review.what_worked,
              whatDidntWork: exec.review.what_didnt_work,
              outputWasUseful: exec.review.output_was_useful,
              outputWasCorrect: exec.review.output_was_correct,
              outputWasComplete: exec.review.output_was_complete,
              errorWasAppropriate: exec.review.error_was_appropriate,
              wouldUseAgain: exec.review.would_use_again,
              suggestedImprovements: exec.review.suggested_improvements,
              requiredWorkaround: exec.review.required_workaround,
              workaroundDescription: exec.review.workaround_description,
            }
          : null,
      })),
      totalFound: response.total_found,
    };
  }

  // =========================================================================
  // Voting API
  // =========================================================================

  /**
   * Vote on whether a cached code snippet was useful for a task.
   *
   * This triggers background voting on the backend to assess whether
   * the cached code actually helped complete the task successfully.
   * The call returns immediately - voting happens asynchronously.
   */
  async voteCodeSnip(params: {
    task: string;
    codeBlockId: string;
    codeBlockName: string;
    codeBlockDescription: string;
    succeeded: boolean;
  }): Promise<{ success: boolean; votePending: boolean; message: string }> {
    const data = {
      task: params.task,
      code_block_id: params.codeBlockId,
      code_block_name: params.codeBlockName,
      code_block_description: params.codeBlockDescription,
      succeeded: params.succeeded,
    };

    const result = await this.request<{
      success: boolean;
      vote_pending: boolean;
      message: string;
    }>("POST", "/api/store/cache-usage", data);

    return {
      success: result.success,
      votePending: result.vote_pending,
      message: result.message,
    };
  }

  /**
   * Add a comment to a cached code snippet.
   */
  async commentOnCodeSnip(params: {
    codeBlockId: string;
    text: string;
  }): Promise<{
    success: boolean;
    comment: { id: string; email: string; text: string; createdAt: string };
  }> {
    const result = await this.request<{
      success: boolean;
      comment: {
        id: string;
        email: string;
        text: string;
        created_at: string;
      };
    }>("POST", "/api/store/comment", {
      code_block_id: params.codeBlockId,
      text: params.text,
    });

    return {
      success: result.success,
      comment: {
        id: result.comment.id,
        email: result.comment.email,
        text: result.comment.text,
        createdAt: result.comment.created_at,
      },
    };
  }

  // =========================================================================
  // Public Snippet Browsing (no API key required)
  // =========================================================================

  /** Browse community public snippets without authentication. */
  async browsePublic(
    params: BrowsePublicParams = {},
  ): Promise<BrowsePublicResponse> {
    const data = {
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      sort_by: params.sortBy ?? "upvoted",
      language: params.language,
    };

    const result = await this.request<{
      snippets: Array<{
        id: string;
        name: string;
        description: string;
        source: string;
        language: string;
        entrypoint: string;
        thumbs_up: number;
        thumbs_down: number;
        created_at: string | null;
        namespace: string;
      }>;
      total: number;
      has_more: boolean;
    }>("POST", "/api/snippets/public/list", data);

    return {
      snippets: result.snippets.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        source: s.source,
        language: s.language,
        entrypoint: s.entrypoint,
        thumbsUp: s.thumbs_up,
        thumbsDown: s.thumbs_down,
        createdAt: s.created_at,
        namespace: s.namespace,
      })),
      total: result.total,
      hasMore: result.has_more,
    };
  }

  /** Search community public snippets by keyword without authentication. */
  async searchPublic(
    params: SearchPublicParams,
  ): Promise<SearchPublicResponse> {
    const data = {
      query: params.query,
      limit: params.limit ?? 20,
      language: params.language,
    };

    const result = await this.request<{
      snippets: Array<{
        id: string;
        name: string;
        description: string;
        source: string;
        language: string;
        entrypoint: string;
        thumbs_up: number;
        thumbs_down: number;
        created_at: string | null;
        namespace: string;
      }>;
      total: number;
      query: string;
    }>("POST", "/api/snippets/public/search", data);

    return {
      snippets: result.snippets.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        source: s.source,
        language: s.language,
        entrypoint: s.entrypoint,
        thumbsUp: s.thumbs_up,
        thumbsDown: s.thumbs_down,
        createdAt: s.created_at,
        namespace: s.namespace,
      })),
      total: result.total,
      query: result.query,
    };
  }

  // =========================================================================
  // Execute API (programmatic tool calling)
  // =========================================================================

  /** Register a tool that can be called by the server during execute. */
  tool(
    name: string,
    description: string,
    parameters: Record<string, JsonValue>,
    callback: ToolCallback,
  ): void {
    this.registeredTools.set(name, {
      definition: { name, description, parameters },
      callback,
    });
  }

  /** Execute a task with tool calling in a remote sandbox. */
  async execute(task: string, options: ExecuteOptions): Promise<ExecuteResult> {
    const hasUserCode =
      typeof options?.userCode === "string" &&
      options.userCode.trim().length > 0;
    const hasCodegen = options?.codegen !== undefined;
    if (hasUserCode === hasCodegen) {
      throw new Error(
        `Invalid execute mode. Provide exactly one of userCode or codegen. Received userCode=${String(options?.userCode)}, codegen=${String(options?.codegen !== undefined)}. Docs: https://docs.raysurfer.com/sdk/typescript#programmatic-tool-calling`,
      );
    }

    if (hasCodegen) {
      const apiKey = options.codegen?.apiKey;
      const prompt = options.codegen?.prompt;
      const model = options.codegen?.model;
      if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
        throw new Error(
          `Invalid codegen.apiKey value: ${String(apiKey)}. Expected a non-empty API key string. Docs: https://docs.raysurfer.com/sdk/typescript#programmatic-tool-calling`,
        );
      }
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new Error(
          `Invalid codegen.prompt value: ${String(prompt)}. Expected a non-empty prompt string. Docs: https://docs.raysurfer.com/sdk/typescript#programmatic-tool-calling`,
        );
      }
      if (
        model !== undefined &&
        (typeof model !== "string" || model.trim().length === 0)
      ) {
        throw new Error(
          `Invalid codegen.model value: ${String(model)}. Expected a non-empty model string when provided. Docs: https://docs.raysurfer.com/sdk/typescript#programmatic-tool-calling`,
        );
      }
    }

    const timeout = options.timeout ?? 300000;
    const sessionId = crypto.randomUUID();

    // Build WebSocket URL: replace http(s) with ws(s)
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/api/execute/ws/${sessionId}`;

    const toolCalls: ToolCallRecord[] = [];

    // Connect WebSocket
    const ws = new WebSocket(wsUrl);

    const wsReady = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (ev) =>
        reject(new Error(`WebSocket connection failed: ${String(ev)}`)),
      );
    });

    // Set up message handler for tool calls
    ws.addEventListener("message", async (event) => {
      const raw =
        typeof event.data === "string" ? event.data : String(event.data);
      let msg: {
        type: string;
        request_id?: string;
        tool_name?: string;
        arguments?: Record<string, JsonValue>;
      };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === "tool_call" && msg.request_id && msg.tool_name) {
        const start = Date.now();
        const registered = this.registeredTools.get(msg.tool_name);
        const record: ToolCallRecord = {
          toolName: msg.tool_name,
          arguments: msg.arguments ?? {},
          result: null,
          error: null,
          durationMs: 0,
        };

        try {
          if (!registered) {
            throw new Error(`Unknown tool: ${msg.tool_name}`);
          }
          const callbackResult = registered.callback(msg.arguments ?? {});
          const result =
            callbackResult instanceof Promise
              ? await callbackResult
              : callbackResult;
          record.result = result;
          record.durationMs = Date.now() - start;

          ws.send(
            JSON.stringify({
              type: "tool_result",
              request_id: msg.request_id,
              result,
            }),
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          record.error = errorMsg;
          record.durationMs = Date.now() - start;

          ws.send(
            JSON.stringify({
              type: "tool_result",
              request_id: msg.request_id,
              result: `Error: ${errorMsg}`,
            }),
          );
        }

        toolCalls.push(record);
      }
    });

    await wsReady;

    // Build tool schemas (definitions only, no callbacks)
    const tools = Array.from(this.registeredTools.values()).map(
      (t) => t.definition,
    );

    const requestBody: {
      task: string;
      tools: ToolDefinition[];
      session_id: string;
      timeout_seconds: number;
      user_code?: string;
      org_id?: string;
      workspace_id?: string;
      codegen?: {
        provider: "anthropic";
        api_key: string;
        model: string;
        prompt: string;
      };
    } = {
      task,
      tools,
      session_id: sessionId,
      timeout_seconds: timeout / 1000,
    };
    if (this.organizationId) {
      requestBody.org_id = this.organizationId;
    }
    if (this.workspaceId) {
      requestBody.workspace_id = this.workspaceId;
    }
    if (hasUserCode) {
      requestBody.user_code = options.userCode ?? "";
    } else {
      requestBody.codegen = {
        provider: options.codegen?.provider ?? "anthropic",
        api_key: options.codegen?.apiKey ?? "",
        model: options.codegen?.model ?? "claude-opus-4-6",
        prompt: options.codegen?.prompt ?? "",
      };
    }

    // POST to /api/execute/run
    const response = await this.request<{
      execution_id: string;
      result: string | null;
      exit_code: number;
      duration_ms: number;
      cache_hit: boolean;
      code_block_id: string | null;
      error: string | null;
      tool_calls: Array<{
        tool_name: string;
        arguments: Record<string, JsonValue>;
        result: string | null;
        error: string | null;
        duration_ms: number;
      }>;
    }>("POST", "/api/execute/run", {
      ...requestBody,
    });

    // Close WebSocket
    ws.close();

    // Merge server-reported tool calls with local records
    const serverToolCalls: ToolCallRecord[] = (response.tool_calls ?? []).map(
      (tc) => ({
        toolName: tc.tool_name,
        arguments: tc.arguments,
        result: tc.result,
        error: tc.error,
        durationMs: tc.duration_ms,
      }),
    );

    return {
      executionId: response.execution_id,
      result: response.result,
      exitCode: response.exit_code,
      durationMs: response.duration_ms,
      cacheHit: response.cache_hit,
      codeBlockId: response.code_block_id,
      error: response.error,
      toolCalls: serverToolCalls.length > 0 ? serverToolCalls : toolCalls,
    };
  }

  /** Execute client-generated Python code in the remote sandbox with tool callbacks. */
  async executeGeneratedCode(
    task: string,
    userCode: string,
    options?: Partial<Pick<ExecuteOptions, "timeout">>,
  ): Promise<ExecuteResult> {
    return this.execute(task, {
      timeout: options?.timeout,
      userCode,
    });
  }

  /** Generate code inside sandbox using provider key+prompt, then execute it. */
  async executeWithSandboxCodegen(
    task: string,
    codegen: NonNullable<ExecuteOptions["codegen"]>,
    options?: Partial<Pick<ExecuteOptions, "timeout">>,
  ): Promise<ExecuteResult> {
    return this.execute(task, {
      timeout: options?.timeout,
      codegen,
    });
  }

  /** Publish agent-accessible functions as function registry snippets. */
  async publishFunctionRegistry(
    functions: AgentRegistryFunction[],
  ): Promise<string[]> {
    const snippetNames: string[] = [];
    for (const fn of functions) {
      if (!fn._raysurferAccessible || !fn._raysurferSchema) continue;
      const schema = fn._raysurferSchema;
      const response = await this.upload({
        task: `Call ${schema.name}: ${schema.description}`,
        fileWritten: { path: `${schema.name}.ts`, content: schema.source },
        succeeded: true,
        useRaysurferAiVoting: false,
        tags: ["function_registry", "agent_accessible"],
      });
      if (response.snippetName) {
        snippetNames.push(response.snippetName);
        schema.codeBlockId = response.snippetName;
      }
      fn._raysurferClient = this;
    }
    return snippetNames;
  }

  // =========================================================================
  // Backwards-compatible aliases
  // =========================================================================

  async submitExecutionResult(
    task: string,
    fileWritten: FileWritten,
    succeeded: boolean,
  ): Promise<SubmitExecutionResultResponse> {
    /** Alias for upload for backwards compatibility. */
    return this.upload(task, fileWritten, succeeded);
  }

  async retrieve(params: RetrieveParams): Promise<RetrieveCodeBlockResponse> {
    /** Alias for getCodeSnips for backwards compatibility. */
    return this.getCodeSnips(params);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private parseCodeBlock(data: RawCodeBlockData): CodeBlock {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      source: data.source,
      entrypoint: data.entrypoint,
      inputSchema: data.input_schema ?? {},
      outputSchema: data.output_schema ?? {},
      language: data.language,
      languageVersion: data.language_version ?? null,
      dependencies: normalizeDependencies(data.dependencies),
      tags: data.tags ?? [],
      capabilities: data.capabilities ?? [],
      exampleQueries: data.example_queries ?? null,
      createdAt: data.created_at ?? null,
      updatedAt: data.updated_at ?? null,
      agentId: data.agent_id ?? null,
    };
  }
}

// Export as default as well for convenience
export default RaySurfer;
