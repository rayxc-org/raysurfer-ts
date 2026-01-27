/**
 * RaySurfer SDK client
 */

import { APIError, AuthenticationError } from "./errors";

export const VERSION = "0.3.9";

import type {
  AgentReview,
  AgentVerdict,
  AlternativeCandidate,
  AutoReviewParams,
  AutoReviewResponse,
  BestMatch,
  CodeBlock,
  CodeBlockMatch,
  CodeFile,
  ExecutionIO,
  ExecutionState,
  FewShotExample,
  FileWritten,
  GetCodeFilesResponse,
  GetExecutionsParams,
  RetrieveBestResponse,
  RetrieveCodeBlockResponse,
  RetrieveExecutionsResponse,
  SnipsDesired,
  StoreCodeBlockResponse,
  StoreExecutionResponse,
  SubmitExecutionResultResponse,
  TaskPattern,
} from "./types";

const DEFAULT_BASE_URL = "https://web-production-3d338.up.railway.app";

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
  /** Whether to include public/shared snippets in retrieval (default: false) */
  publicSnips?: boolean;
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

/**
 * Async client for RaySurfer API
 */
export class RaySurfer {
  private apiKey?: string;
  private baseUrl: string;
  private timeout: number;
  private organizationId?: string;
  private workspaceId?: string;
  private publicSnips: boolean;
  private snipsDesired?: SnipsDesired;
  private namespace?: string;

  constructor(options: RaySurferOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = options.timeout ?? 60000;
    this.organizationId = options.organizationId;
    this.workspaceId = options.workspaceId;
    this.publicSnips = options.publicSnips ?? false;
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
    if (this.publicSnips) {
      headers["X-Raysurfer-Public-Snips"] = "true";
    }
    if (this.snipsDesired) {
      headers["X-Raysurfer-Snips-Desired"] = this.snipsDesired;
    }
    // Custom namespace override
    if (this.namespace) {
      headers["X-Raysurfer-Namespace"] = this.namespace;
    }
    // SDK version for tracking
    headers["X-Raysurfer-SDK-Version"] = `typescript/${VERSION}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new AuthenticationError();
      }

      if (!response.ok) {
        const text = await response.text();
        throw new APIError(text, response.status);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
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
   * Submit raw execution result - backend handles all processing.
   *
   * This is the simplified API for agent integrations. Just send:
   * - The task that was executed
   * - Files that were written during execution
   * - Whether the task succeeded
   * - (Optional) Cached code blocks that were retrieved and used
   *
   * Backend handles: entrypoint detection, tag extraction, language detection,
   * deduplication, quality checks, storage, AND voting for cached code blocks.
   */
  async submitExecutionResult(
    task: string,
    filesWritten: FileWritten[],
    succeeded: boolean,
    cachedCodeBlocks?: Array<{
      codeBlockId: string;
      filename: string;
      description: string;
    }>,
  ): Promise<SubmitExecutionResultResponse> {
    const data: Record<string, unknown> = {
      task,
      files_written: filesWritten,
      succeeded,
    };

    // Include cached code blocks for backend voting if provided
    if (cachedCodeBlocks && cachedCodeBlocks.length > 0) {
      console.log(
        `[raysurfer] Including ${cachedCodeBlocks.length} cached code blocks for voting:`,
      );
      cachedCodeBlocks.forEach((cb, i) => {
        console.log(`[raysurfer]   ${i + 1}. ${cb.codeBlockId} (${cb.filename})`);
      });
      data.cached_code_blocks = cachedCodeBlocks.map((cb) => ({
        code_block_id: cb.codeBlockId,
        filename: cb.filename,
        description: cb.description,
      }));
    } else {
      console.log(`[raysurfer] No cached code blocks to vote on`);
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

  // =========================================================================
  // Retrieve API
  // =========================================================================

  /** Retrieve code blocks by task description (semantic search) */
  async retrieve(params: RetrieveParams): Promise<RetrieveCodeBlockResponse> {
    const data = {
      task: params.task,
      top_k: params.topK ?? 10,
      min_verdict_score: params.minVerdictScore ?? 0.0,
    };

    const result = await this.request<{
      code_blocks: Array<{
        code_block: Record<string, unknown>;
        score: number;
        verdict_score: number;
        thumbs_up: number;
        thumbs_down: number;
        recent_executions?: unknown[];
      }>;
      total_found: number;
    }>("POST", "/api/retrieve/code-blocks", data);

    const codeBlocks: CodeBlockMatch[] = result.code_blocks.map((cb) => ({
      codeBlock: this.parseCodeBlock(cb.code_block),
      score: cb.score,
      verdictScore: cb.verdict_score,
      thumbsUp: cb.thumbs_up,
      thumbsDown: cb.thumbs_down,
      recentExecutions: (cb.recent_executions ?? []) as [],
    }));

    return {
      codeBlocks,
      totalFound: result.total_found,
    };
  }

  /** Get the single best code block for a task using verdict-aware scoring */
  async retrieveBest(params: RetrieveParams): Promise<RetrieveBestResponse> {
    const data = {
      task: params.task,
      top_k: params.topK ?? 10,
      min_verdict_score: params.minVerdictScore ?? 0.0,
    };

    const result = await this.request<{
      best_match?: {
        code_block: Record<string, unknown>;
        combined_score: number;
        vector_score: number;
        verdict_score: number;
        error_resilience: number;
        thumbs_up: number;
        thumbs_down: number;
      };
      alternative_candidates: Array<{
        code_block_id: string;
        name: string;
        combined_score: number;
        reason: string;
      }>;
      retrieval_confidence: string;
    }>("POST", "/api/retrieve/best-for-task", data);

    let bestMatch: BestMatch | null = null;
    if (result.best_match) {
      bestMatch = {
        codeBlock: this.parseCodeBlock(result.best_match.code_block),
        combinedScore: result.best_match.combined_score,
        vectorScore: result.best_match.vector_score,
        verdictScore: result.best_match.verdict_score,
        errorResilience: result.best_match.error_resilience,
        thumbsUp: result.best_match.thumbs_up,
        thumbsDown: result.best_match.thumbs_down,
      };
    }

    const alternativeCandidates: AlternativeCandidate[] =
      result.alternative_candidates.map((alt) => ({
        codeBlockId: alt.code_block_id,
        name: alt.name,
        combinedScore: alt.combined_score,
        reason: alt.reason,
      }));

    return {
      bestMatch,
      alternativeCandidates,
      retrievalConfidence: result.retrieval_confidence,
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

  /**
   * Get code files for a task, ready to download to sandbox.
   *
   * Returns code blocks with full source code, optimized for:
   * - High verdict scores (proven to work)
   * - More complete implementations (prefer longer source)
   * - Task relevance (semantic similarity)
   *
   * Also returns `addToLlmPrompt` - a pre-formatted string you can append
   * to your LLM system prompt to inform it about the cached files.
   */
  async getCodeFiles(
    params: GetCodeFilesParams,
  ): Promise<GetCodeFilesResponse> {
    const data = {
      task: params.task,
      top_k: params.topK ?? 5,
      min_verdict_score: params.minVerdictScore ?? 0.3,
      prefer_complete: params.preferComplete ?? true,
    };

    const result = await this.request<{
      files: Array<{
        code_block_id: string;
        filename: string;
        source: string;
        entrypoint: string;
        description: string;
        input_schema: Record<string, unknown>;
        output_schema: Record<string, unknown>;
        language: string;
        dependencies: string[];
        verdict_score: number;
        thumbs_up: number;
        thumbs_down: number;
        similarity_score: number;
        combined_score: number;
      }>;
      task: string;
      total_found: number;
    }>("POST", "/api/retrieve/code-files", data);

    const files: CodeFile[] = result.files.map((f) => ({
      codeBlockId: f.code_block_id,
      filename: f.filename,
      source: f.source,
      entrypoint: f.entrypoint,
      description: f.description,
      inputSchema: f.input_schema,
      outputSchema: f.output_schema,
      language: f.language,
      dependencies: f.dependencies,
      verdictScore: f.verdict_score,
      thumbsUp: f.thumbs_up,
      thumbsDown: f.thumbs_down,
      similarityScore: f.similarity_score,
      combinedScore: f.combined_score,
    }));

    // Generate the addToLlmPrompt string (default cache dir: .raysurfer_code)
    const addToLlmPrompt = this.formatLlmPrompt(
      files,
      params.cacheDir ?? ".raysurfer_code",
    );

    return {
      files,
      task: result.task,
      totalFound: result.total_found,
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
   * Record that a cached code block was used for a task.
   *
   * This triggers background voting on the backend to assess whether
   * the cached code actually helped complete the task successfully.
   * The call returns immediately - voting happens asynchronously.
   */
  async recordCacheUsage(params: {
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
  // Simplified API (aliases)
  // =========================================================================

  /**
   * Get cached code snippets for a task.
   *
   * Alias for retrieve() - searches for code blocks by task description.
   */
  async getCodeSnips(
    params: RetrieveParams,
  ): Promise<RetrieveCodeBlockResponse> {
    return this.retrieve(params);
  }

  /**
   * Upload new code snippets from an execution.
   *
   * Alias for submitExecutionResult() - stores code files for future reuse.
   */
  async uploadNewCodeSnips(
    task: string,
    filesWritten: FileWritten[],
    succeeded: boolean,
    cachedCodeBlocks?: Array<{
      codeBlockId: string;
      filename: string;
      description: string;
    }>,
  ): Promise<SubmitExecutionResultResponse> {
    return this.submitExecutionResult(
      task,
      filesWritten,
      succeeded,
      cachedCodeBlocks,
    );
  }

  /**
   * Vote on whether a cached code snippet was useful.
   *
   * Alias for recordCacheUsage() - triggers background voting.
   */
  async voteCodeSnip(params: {
    task: string;
    codeBlockId: string;
    codeBlockName: string;
    codeBlockDescription: string;
    succeeded: boolean;
  }): Promise<{ success: boolean; votePending: boolean; message: string }> {
    return this.recordCacheUsage(params);
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
