/**
 * RaySurfer SDK types - mirrors the backend API types
 */

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
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
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
  inputData: Record<string, unknown>;
  inputHash?: string;
  outputData?: unknown;
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

/** The best matching code block with full scoring */
export interface BestMatch {
  codeBlock: CodeBlock;
  combinedScore: number;
  vectorScore: number;
  verdictScore: number;
  errorResilience: number;
  thumbsUp: number;
  thumbsDown: number;
}

/** An alternative candidate code block */
export interface AlternativeCandidate {
  codeBlockId: string;
  name: string;
  combinedScore: number;
  reason: string;
}

/** A few-shot example for code generation */
export interface FewShotExample {
  task: string;
  inputSample: Record<string, unknown>;
  outputSample: unknown;
  codeSnippet: string;
}

/** A proven task->code mapping */
export interface TaskPattern {
  taskPattern: string;
  codeBlockId: string;
  codeBlockName: string;
  thumbsUp: number;
  thumbsDown: number;
  verdictScore: number;
  errorResilience: number;
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
  verdictScore: number;
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
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  language: string;
  /** Package name -> version (e.g., {"pandas": "2.1.0"}) */
  dependencies: Record<string, string>;
  /** Rating score: thumbsUp / (thumbsUp + thumbsDown), 0.3 if unrated */
  verdictScore: number;
  thumbsUp: number;
  thumbsDown: number;
  /** Semantic similarity (0-1) */
  similarityScore: number;
  /** Combined score: similarity * 0.6 + verdict * 0.4 */
  combinedScore: number;
}

/** Response with code files for a task */
export interface GetCodeFilesResponse {
  files: CodeFile[];
  task: string;
  totalFound: number;
  /** Pre-formatted string to append to LLM system prompt with all file paths */
  addToLlmPrompt: string;
}

/** A search match with full scoring from unified search */
export interface SearchMatch {
  codeBlock: CodeBlock;
  combinedScore: number;
  vectorScore: number;
  verdictScore: number;
  errorResilience: number;
  thumbsUp: number;
  thumbsDown: number;
  filename: string;
  language: string;
  entrypoint: string;
  /** Package name -> version (e.g., {"pandas": "2.1.0"}) */
  dependencies: Record<string, string>;
}

/** Response from unified search endpoint */
export interface SearchResponse {
  matches: SearchMatch[];
  totalFound: number;
  cacheHit: boolean;
  searchNamespaces: string[];
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
  inputData: Record<string, unknown>;
  outputData: unknown;
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
  fileWritten: FileWritten;
  succeeded: boolean;
  cachedCodeBlocks?: Array<{
    codeBlockId: string;
    filename: string;
    description: string;
  }>;
  useRaysurferAiVoting?: boolean;
  userVote?: number;
  executionLogs?: string;
  runUrl?: string;
  workspaceId?: string;
  /** Package dependencies with versions (e.g., {"pandas": "2.1.0"}) */
  dependencies?: Record<string, string>;
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
