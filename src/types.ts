/**
 * RaySurfer SDK types - mirrors the backend API types
 */

/** JSON-serializable value for unstructured execution output data */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Technical execution outcome - NOT a quality judgment */
export enum ExecutionState {
  COMPLETED = "completed",
  ERRORED = "errored",
  TIMED_OUT = "timed_out",
  CANCELLED = "cancelled",
}

/** Agent's judgment on whether an execution was useful */
export enum AgentVerdict {
  THUMBS_UP = "thumbs_up",
  THUMBS_DOWN = "thumbs_down",
  PENDING = "pending",
}

/** Scope of private snippets for retrieval */
export type SnipsDesired = "company" | "client";

/** A stored code block with metadata for semantic retrieval */
export interface CodeBlock {
  id: string;
  name: string;
  description: string;
  source: string;
  entrypoint: string;
  inputSchema: Record<string, JsonValue>;
  outputSchema: Record<string, JsonValue>;
  language: string;
  languageVersion?: string | null;
  /** Package name -> version (e.g., {"pandas": "2.1.0"}) */
  dependencies: Record<string, string>;
  tags: string[];
  capabilities: string[];
  exampleQueries?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Stores the actual input/output data */
export interface ExecutionIO {
  inputData: Record<string, JsonValue>;
  inputHash?: string;
  outputData?: JsonValue;
  outputHash?: string;
  outputType?: string;
}

/** Agent's assessment of whether an execution was useful */
export interface AgentReview {
  timestamp?: string;
  verdict: AgentVerdict;
  reasoning: string;
  whatWorked: string[];
  whatDidntWork: string[];
  outputWasUseful: boolean;
  outputWasCorrect: boolean;
  outputWasComplete: boolean;
  errorWasAppropriate?: boolean | null;
  wouldUseAgain: boolean;
  suggestedImprovements: string[];
  requiredWorkaround?: boolean;
  workaroundDescription?: string | null;
}

/** Full execution trace */
export interface ExecutionRecord {
  id: string;
  codeBlockId: string;
  timestamp?: string;
  executionState: ExecutionState;
  durationMs: number;
  errorMessage?: string | null;
  errorType?: string | null;
  io: ExecutionIO;
  triggeringTask: string;
  retrievalScore?: number;
  verdict?: AgentVerdict;
  review?: AgentReview | null;
}

/** The best matching code block with scoring */
export interface BestMatch {
  codeBlock: CodeBlock;
  score: number;
  thumbsUp: number;
  thumbsDown: number;
}

/** An alternative candidate code block */
export interface AlternativeCandidate {
  codeBlockId: string;
  name: string;
  score: number;
  reason: string;
}

/** A few-shot example for code generation */
export interface FewShotExample {
  task: string;
  inputSample: Record<string, JsonValue>;
  outputSample: JsonValue;
  codeSnippet: string;
}

/** A proven task->code mapping */
export interface TaskPattern {
  taskPattern: string;
  codeBlockId: string;
  codeBlockName: string;
  thumbsUp: number;
  thumbsDown: number;
  lastThumbsUp?: string | null;
  lastThumbsDown?: string | null;
}

/** A file written during agent execution */
export interface FileWritten {
  path: string;
  content: string;
}

/** A log file for bulk grading (content may be base64) */
export interface LogFile {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
  contentType?: string;
}

// Response types

export interface StoreCodeBlockResponse {
  success: boolean;
  codeBlockId: string;
  embeddingId: string;
  message: string;
}

export interface StoreExecutionResponse {
  success: boolean;
  executionId: string;
  patternUpdated: boolean;
  message: string;
}

export interface CodeBlockMatch {
  codeBlock: CodeBlock;
  score: number;
  thumbsUp: number;
  thumbsDown: number;
  recentExecutions: ExecutionRecord[];
}

export interface RetrieveCodeBlockResponse {
  codeBlocks: CodeBlockMatch[];
  totalFound: number;
}

export interface RetrieveBestResponse {
  bestMatch: BestMatch | null;
  alternativeCandidates: AlternativeCandidate[];
  retrievalConfidence: string;
}

export interface SubmitExecutionResultRequest {
  task: string;
  fileWritten: FileWritten;
  succeeded: boolean;
  /** Let Raysurfer AI vote on stored blocks (default true). Ignored when userVote is provided. */
  useRaysurferAiVoting?: boolean;
  /** User-provided vote: 1 for thumbs up, -1 for thumbs down. When provided, AI voting is skipped. */
  userVote?: number;
  /** URL to the finished run (e.g. logs page, CI run, LangSmith trace) */
  runUrl?: string;
}

export interface SubmitExecutionResultResponse {
  success: boolean;
  codeBlocksStored: number;
  message: string;
  snippetName?: string | null;
}

export interface BulkExecutionResultRequest {
  prompts: string[];
  filesWritten: FileWritten[];
  logFiles?: LogFile[];
  /** Let Raysurfer AI vote on stored blocks (default true). Ignored when userVotes is provided. */
  useRaysurferAiVoting?: boolean;
  /** Dict of filename to vote (1 for thumbs up, -1 for thumbs down). When provided, AI voting is skipped. */
  userVotes?: Record<string, number>;
}

export interface BulkExecutionResultResponse {
  success: boolean;
  codeBlocksStored: number;
  votesQueued: number;
  message: string;
  statusUrl?: string | null;
}

// SDK-specific types

/** A code file ready to be written to sandbox */
export interface CodeFile {
  codeBlockId: string;
  filename: string;
  source: string;
  entrypoint: string;
  description: string;
  inputSchema: Record<string, JsonValue>;
  outputSchema: Record<string, JsonValue>;
  language: string;
  /** Package name -> version (e.g., {"pandas": "2.1.0"}) */
  dependencies: Record<string, string>;
  score: number;
  thumbsUp: number;
  thumbsDown: number;
}

/** Response with code files for a task */
export interface GetCodeFilesResponse {
  files: CodeFile[];
  task: string;
  totalFound: number;
  /** Pre-formatted string to append to LLM system prompt with all file paths */
  addToLlmPrompt: string;
}

/** A search match with scoring */
export interface SearchMatch {
  codeBlock: CodeBlock;
  score: number;
  /** Compatibility alias used by older wrappers. */
  combinedScore: number;
  /** Compatibility alias used by older wrappers. */
  vectorScore: number;
  /** Compatibility alias used by older wrappers. */
  verdictScore: number;
  thumbsUp: number;
  thumbsDown: number;
  filename: string;
  language: string;
  entrypoint: string;
  /** Package name -> version (e.g., {"pandas": "2.1.0"}) */
  dependencies: Record<string, string>;
  comments: Record<string, JsonValue>[];
}

/** Response from unified search endpoint */
export interface SearchResponse {
  matches: SearchMatch[];
  totalFound: number;
  cacheHit: boolean;
}

/** Request to vote on a code snippet */
export interface VoteCodeSnipParams {
  task: string;
  codeBlockId: string;
  codeBlockName: string;
  codeBlockDescription: string;
  succeeded: boolean;
}

/** Response from voting on a code snippet */
export interface VoteCodeSnipResponse {
  success: boolean;
  votePending: boolean;
  message: string;
}

// ============================================================================
// Auto Review API
// ============================================================================

/** Request for auto-review by Claude */
export interface AutoReviewParams {
  executionId: string;
  triggeringTask: string;
  executionState: ExecutionState;
  inputData: Record<string, JsonValue>;
  outputData: JsonValue;
  codeBlockName: string;
  codeBlockDescription: string;
  errorMessage?: string | null;
}

/** Response with auto-generated review */
export interface AutoReviewResponse {
  success: boolean;
  executionId: string;
  review: AgentReview;
  message: string;
}

// ============================================================================
// Get Executions API
// ============================================================================

/** Request to retrieve executions */
export interface GetExecutionsParams {
  codeBlockId?: string | null;
  task?: string | null;
  verdict?: AgentVerdict | null;
  limit?: number;
}

/** Response with executions */
export interface RetrieveExecutionsResponse {
  executions: ExecutionRecord[];
  totalFound: number;
}

// ============================================================================
// Options interfaces for kwargs-style API calls
// ============================================================================

/** Options for uploadNewCodeSnip (kwargs-style) */
export interface UploadNewCodeSnipOptions {
  task: string;
  fileWritten?: FileWritten;
  /** Compatibility alias for legacy wrappers that pass multiple files. */
  filesWritten?: FileWritten[];
  succeeded: boolean;
  cachedCodeBlocks?: Array<{
    codeBlockId: string;
    filename: string;
    description: string;
  }>;
  useRaysurferAiVoting?: boolean;
  /** Compatibility alias for useRaysurferAiVoting. */
  autoVote?: boolean;
  userVote?: number;
  executionLogs?: string;
  runUrl?: string;
  workspaceId?: string;
  /** Package dependencies with versions (e.g., {"pandas": "2.1.0"}) */
  dependencies?: Record<string, string>;
  /** Upload to the public community namespace (default false) */
  public?: boolean;
}

// ============================================================================
// Public Snippet Browsing API
// ============================================================================

/** A public community snippet from the curated namespace */
export interface PublicSnippet {
  id: string;
  name: string;
  description: string;
  source: string;
  language: string;
  entrypoint: string;
  thumbsUp: number;
  thumbsDown: number;
  createdAt: string | null;
  namespace: string;
}

/** Response from browsing public snippets */
export interface BrowsePublicResponse {
  snippets: PublicSnippet[];
  total: number;
  hasMore: boolean;
}

/** Response from searching public snippets */
export interface SearchPublicResponse {
  snippets: PublicSnippet[];
  total: number;
  query: string;
}

/** Params for browsing public snippets */
export interface BrowsePublicParams {
  limit?: number;
  offset?: number;
  sortBy?: "upvoted" | "recent";
  language?: string;
}

/** Params for searching public snippets */
export interface SearchPublicParams {
  query: string;
  limit?: number;
  language?: string;
}

// ============================================================================
// Execute API (programmatic tool calling)
// ============================================================================

/** Definition of a tool that can be called during execution */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, JsonValue>;
}

/** Callback function invoked when the server calls a tool */
export type ToolCallback = (
  args: Record<string, JsonValue>,
) => Promise<string> | string;

/** Options for the execute method */
export interface ExecuteOptions {
  /** Timeout in milliseconds (default 300000 = 5 minutes) */
  timeout: number;
  /** Force regeneration instead of using cached code (default false) */
  forceRegenerate: boolean;
}

/** Record of a single tool call made during execution */
export interface ToolCallRecord {
  toolName: string;
  arguments: Record<string, JsonValue>;
  result: string | null;
  error: string | null;
  durationMs: number;
}

/** Result of an execute call */
export interface ExecuteResult {
  executionId: string;
  result: string | null;
  exitCode: number;
  durationMs: number;
  cacheHit: boolean;
  codeBlockId: string | null;
  error: string | null;
  toolCalls: ToolCallRecord[];
}

/** Options for uploadBulkCodeSnips (kwargs-style) */
export interface UploadBulkCodeSnipsOptions {
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
}
