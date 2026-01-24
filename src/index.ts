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

export type {
  GetCodeFilesParams,
  GetTaskPatternsParams,
  RaySurferOptions,
  RetrieveParams,
  StoreCodeBlockParams,
  StoreExecutionParams,
} from "./client";
// Direct API client (for advanced use cases)
export { default as RaySurferDefault, RaySurfer } from "./client";
// Errors
export { APIError, AuthenticationError, RaySurferError } from "./errors";
export type {
  QueryOptions,
  QueryParams,
  RaysurferAgentOptions,
} from "./sdk-client";
// Drop-in replacement for Claude Agent SDK (primary exports)
export {
  ClaudeSDKClient,
  default as queryDefault,
  query,
  RaysurferClient,
} from "./sdk-client";
export type {
  AgentReview,
  AlternativeCandidate,
  BestMatch,
  CodeBlock,
  CodeBlockMatch,
  CodeFile,
  ExecutionIO,
  ExecutionRecord,
  FewShotExample,
  FileWritten,
  GetCodeFilesResponse,
  RecordCacheUsageParams,
  RecordCacheUsageResponse,
  RetrieveBestResponse,
  RetrieveCodeBlockResponse,
  StoreCodeBlockResponse,
  StoreExecutionResponse,
  SubmitExecutionResultRequest,
  SubmitExecutionResultResponse,
  TaskPattern,
} from "./types";
// Types
export { AgentVerdict, ExecutionState } from "./types";

export const VERSION = "0.3.5";
