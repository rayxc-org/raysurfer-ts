/**
 * RaySurfer TypeScript SDK - Drop-in replacement for Claude Agent SDK with caching.
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

// Drop-in replacement for Claude Agent SDK (primary exports)
export {
  query,
  ClaudeSDKClient,
  RaysurferClient,
  default as queryDefault,
} from "./sdk-client";
export type {
  QueryOptions,
  QueryParams,
  RaysurferAgentOptions,
} from "./sdk-client";

// Direct API client (for advanced use cases)
export { RaySurfer, default as RaySurferDefault } from "./client";
export type {
  RaySurferOptions,
  StoreCodeBlockParams,
  StoreExecutionParams,
  RetrieveParams,
  GetCodeFilesParams,
  GetTaskPatternsParams,
} from "./client";

// Types
export { ExecutionState, AgentVerdict } from "./types";
export type {
  CodeBlock,
  ExecutionIO,
  AgentReview,
  ExecutionRecord,
  BestMatch,
  AlternativeCandidate,
  FewShotExample,
  TaskPattern,
  FileWritten,
  StoreCodeBlockResponse,
  StoreExecutionResponse,
  CodeBlockMatch,
  RetrieveCodeBlockResponse,
  RetrieveBestResponse,
  SubmitExecutionResultRequest,
  SubmitExecutionResultResponse,
  CodeFile,
  GetCodeFilesResponse,
  RecordCacheUsageParams,
  RecordCacheUsageResponse,
} from "./types";

// Errors
export { RaySurferError, APIError, AuthenticationError } from "./errors";

export const VERSION = "0.3.5";
