/**
 * RaySurfer SDK client
 */

import {
  APIError,
  AuthenticationError,
  CacheUnavailableError,
  RateLimitError,
} from "./errors";

export const VERSION = "0.5.0";

import type {
  AgentReview,
  AgentVerdict,
  AlternativeCandidate,
  AutoReviewParams,
  AutoReviewResponse,
  BestMatch,
  BulkExecutionResultResponse,
  CodeBlock,
  CodeFile,
  ExecutionState,
  FewShotExample,
  FileWritten,
  GetCodeFilesResponse,
  GetExecutionsParams,
  LogFile,
  RetrieveBestResponse,
  RetrieveCodeBlockResponse,
  RetrieveExecutionsResponse,
  SearchResponse,
  SnipsDesired,
  StoreCodeBlockResponse,
  StoreExecutionResponse,
  SubmitExecutionResultResponse,
  TaskPattern,
} from "./types";

const DEFAULT_BASE_URL = "https://api.raysurfer.com";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 500;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

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
  /** Custom namespace for code storage/retrieval (overrides org-based namespacing) */
  namespace?: string;
}

export interface StoreCodeBlockParams {
  name: string;
  source: string;
  entrypoint: string;
  language: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  languageVersion?: string;
  dependencies?: string[];
  tags?: string[];
  capabilities?: string[];
  exampleQueries?: string[];
}

export interface StoreExecutionParams {
  codeBlockId: string;
  triggeringTask: string;
  inputData: Record<string, unknown>;
  outputData: unknown;
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
  preferComplete?: boolean;
  inputSchema?: Record<string, unknown>;
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
  private namespace?: string;

  constructor(options: RaySurferOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = options.timeout ?? 60000;
    this.organizationId = options.organizationId;
    this.workspaceId = options.workspaceId;
    this.snipsDesired = options.snipsDesired;
    this.namespace = options.namespace;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
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
    // Custom namespace override
    if (this.namespace) {
      headers["X-Raysurfer-Namespace"] = this.namespace;
    }
    // SDK version for tracking
    headers["X-Raysurfer-SDK-Version"] = `typescript/${VERSION}`;

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
      dependencies: params.dependencies ?? [],
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
  async uploadNewCodeSnip(
    task: string,
    fileWritten: FileWritten,
    succeeded: boolean,
    cachedCodeBlocks?: Array<{
      codeBlockId: string;
      filename: string;
      description: string;
    }>,
    useRaysurferAiVoting: boolean = true,
    userVote?: number,
    executionLogs?: string,
    runUrl?: string,
  ): Promise<SubmitExecutionResultResponse> {
    const data: Record<string, unknown> = {
      task,
      file_written: fileWritten,
      succeeded,
      use_raysurfer_ai_voting: useRaysurferAiVoting,
    };

    // User-provided vote (skips AI voting automatically)
    if (userVote !== undefined) {
      data.user_vote = userVote;
    }

    // Include execution logs for vote context if provided
    if (executionLogs) {
      data.execution_logs = executionLogs;
    }

    // Include cached code blocks for backend voting if provided
    if (cachedCodeBlocks && cachedCodeBlocks.length > 0) {
      data.cached_code_blocks = cachedCodeBlocks.map((cb) => ({
        code_block_id: cb.codeBlockId,
        filename: cb.filename,
        description: cb.description,
      }));
    }

    // Include run URL for linking to finished run logs
    if (runUrl) {
      data.run_url = runUrl;
    }

    const result = await this.request<{
      success: boolean;
      code_blocks_stored: number;
      message: string;
    }>("POST", "/api/store/execution-result", data);

    return {
      success: result.success,
      codeBlocksStored: result.code_blocks_stored,
      message: result.message,
    };
  }

  /** Backwards-compatible alias. */
  uploadNewCodeSnips = this.uploadNewCodeSnip.bind(this);

  /**
   * Bulk upload code files, prompts, and logs for sandboxed grading.
   *
   * The backend runs a grader that votes thumbs up/down for each code file.
   */
  async uploadBulkCodeSnips(
    prompts: string[],
    filesWritten: FileWritten[],
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
  ): Promise<BulkExecutionResultResponse> {
    const normalizedLogs =
      logFiles?.map((log) => {
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

    const data: Record<string, unknown> = {
      prompts,
      files_written: filesWritten,
      log_files: normalizedLogs.length > 0 ? normalizedLogs : undefined,
      use_raysurfer_ai_voting: useRaysurferAiVoting,
    };

    // User-provided votes (skips AI grading automatically)
    if (userVotes) {
      data.user_votes = userVotes;
    }

    const result = await this.request<{
      success: boolean;
      code_blocks_stored: number;
      votes_queued: number;
      message: string;
      status_url?: string | null;
    }>("POST", "/api/store/bulk-execution-result", data);

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
      prefer_complete: params.preferComplete ?? false,
      input_schema: params.inputSchema ?? null,
    };

    const result = await this.request<{
      matches: Array<{
        code_block: Record<string, unknown>;
        combined_score: number;
        vector_score: number;
        verdict_score: number;
        error_resilience: number;
        thumbs_up: number;
        thumbs_down: number;
        filename: string;
        language: string;
        entrypoint: string;
        dependencies: string[];
      }>;
      total_found: number;
      cache_hit: boolean;
      search_namespaces: string[];
    }>("POST", "/api/retrieve/search", data);

    return {
      matches: result.matches.map((m) => ({
        codeBlock: this.parseCodeBlock(m.code_block),
        combinedScore: m.combined_score,
        vectorScore: m.vector_score,
        verdictScore: m.verdict_score,
        errorResilience: m.error_resilience,
        thumbsUp: m.thumbs_up,
        thumbsDown: m.thumbs_down,
        filename: m.filename,
        language: m.language,
        entrypoint: m.entrypoint,
        dependencies: m.dependencies ?? [],
      })),
      totalFound: result.total_found,
      cacheHit: result.cache_hit,
      searchNamespaces: result.search_namespaces ?? [],
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
        score: m.combinedScore,
        verdictScore: m.verdictScore,
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
        combinedScore: first.combinedScore,
        vectorScore: first.vectorScore,
        verdictScore: first.verdictScore,
        errorResilience: first.errorResilience,
        thumbsUp: first.thumbsUp,
        thumbsDown: first.thumbsDown,
      };
      bestScore = first.combinedScore;
    }
    const alternativeCandidates: AlternativeCandidate[] = response.matches
      .slice(1, 4)
      .map((m) => ({
        codeBlockId: m.codeBlock.id,
        name: m.codeBlock.name,
        combinedScore: m.combinedScore,
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
        input_sample: Record<string, unknown>;
        output_sample: unknown;
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
        verdict_score: number;
        error_resilience: number;
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
      verdictScore: p.verdict_score,
      errorResilience: p.error_resilience,
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
      verdictScore: m.verdictScore,
      thumbsUp: m.thumbsUp,
      thumbsDown: m.thumbsDown,
      similarityScore: m.vectorScore,
      combinedScore: m.combinedScore,
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
      lines.push(`- **Confidence**: ${Math.round(f.verdictScore * 100)}%`);
      if (f.dependencies.length > 0) {
        lines.push(`- **Dependencies**: ${f.dependencies.join(", ")}`);
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
   * Get an auto-generated review using Claude Opus 4.5.
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
          input_data: Record<string, unknown>;
          input_hash: string;
          output_data: unknown;
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

  // =========================================================================
  // Backwards-compatible aliases
  // =========================================================================

  async submitExecutionResult(
    task: string,
    fileWritten: FileWritten,
    succeeded: boolean,
  ): Promise<SubmitExecutionResultResponse> {
    /** Alias for uploadNewCodeSnip for backwards compatibility. */
    return this.uploadNewCodeSnip(task, fileWritten, succeeded);
  }

  async retrieve(params: RetrieveParams): Promise<RetrieveCodeBlockResponse> {
    /** Alias for getCodeSnips for backwards compatibility. */
    return this.getCodeSnips(params);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private parseCodeBlock(data: Record<string, unknown>): CodeBlock {
    return {
      id: data.id as string,
      name: data.name as string,
      description: data.description as string,
      source: data.source as string,
      entrypoint: data.entrypoint as string,
      inputSchema: (data.input_schema ?? {}) as Record<string, unknown>,
      outputSchema: (data.output_schema ?? {}) as Record<string, unknown>,
      language: data.language as string,
      languageVersion: data.language_version as string | null,
      dependencies: (data.dependencies ?? []) as string[],
      tags: (data.tags ?? []) as string[],
      capabilities: (data.capabilities ?? []) as string[],
      exampleQueries: data.example_queries as string[] | null,
      createdAt: data.created_at as string | null,
      updatedAt: data.updated_at as string | null,
    };
  }
}

// Export as default as well for convenience
export default RaySurfer;
