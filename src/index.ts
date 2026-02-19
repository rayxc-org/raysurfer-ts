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

// =============================================================================
// Raysurfer SDK exports (primary)
// =============================================================================

export type {
  GetCodeFilesParams,
  GetTaskPatternsParams,
  RaySurferOptions,
  RetrieveParams,
  SearchParams,
  StoreCodeBlockParams,
  StoreExecutionParams,
} from "./client";
// Direct API client (for advanced use cases)
export { default as RaySurferDefault, RaySurfer, VERSION } from "./client";
export { CodegenApp } from "./agent";
export type {
  CodegenAppOptions,
  CodegenRunGeneratedCodeOptions,
  CodegenRunOptions,
} from "./agent";
// Errors
export {
  APIError,
  AuthenticationError,
  CacheUnavailableError,
  RateLimitError,
  RaySurferError,
  ValidationError,
} from "./errors";
export type {
  QueryOptions,
  QueryParams,
  RaysurferAgentOptions,
  RaysurferExtras,
  RaysurferQueryOptions,
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
  BrowsePublicParams,
  BrowsePublicResponse,
  BulkExecutionResultRequest,
  BulkExecutionResultResponse,
  CodeBlock,
  CodeBlockMatch,
  CodeFile,
  ExecuteOptions,
  ExecuteResult,
  ExecutionIO,
  ExecutionRecord,
  FewShotExample,
  FileWritten,
  GetCodeFilesResponse,
  JsonValue,
  LogFile,
  PublicSnippet,
  RetrieveBestResponse,
  RetrieveCodeBlockResponse,
  RetrieveExecutionsResponse,
  SandboxCodegenOptions,
  SearchMatch,
  SearchPublicParams,
  SearchPublicResponse,
  SearchResponse,
  StoreCodeBlockResponse,
  StoreExecutionResponse,
  SubmitExecutionResultRequest,
  SubmitExecutionResultResponse,
  TaskPattern,
  ToolCallback,
  ToolCallRecord,
  ToolDefinition,
  UploadBulkCodeSnipsOptions,
  UploadNewCodeSnipOptions,
  VoteCodeSnipParams,
  VoteCodeSnipResponse,
} from "./types";
// Types
export { AgentVerdict, ExecutionState } from "./types";

// =============================================================================
// Claude Agent SDK re-exports — so users only need `import { ... } from "raysurfer"`
// =============================================================================

// Core types
// Permission types
// MCP types
// Agent types
// Hook types
// Info types
// Output & config types
// Sandbox types
// Process types
// Misc types
export type {
  AccountInfo,
  AgentDefinition,
  AgentMcpServerSpec,
  AnyZodRawShape,
  ApiKeySource,
  AsyncHookJSONOutput,
  BaseHookInput,
  BaseOutputFormat,
  CanUseTool,
  ConfigScope,
  ExitReason,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  InferShape,
  JsonSchemaOutputFormat,
  McpHttpServerConfig,
  McpSdkServerConfig,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  McpServerConfigForProcessTransport,
  McpServerStatus,
  McpSetServersResult,
  McpSSEServerConfig,
  McpStdioServerConfig,
  ModelInfo,
  ModelUsage,
  NonNullableUsage,
  NotificationHookInput,
  NotificationHookSpecificOutput,
  Options,
  OutputFormat,
  OutputFormatType,
  PermissionBehavior,
  PermissionMode,
  PermissionRequestHookInput,
  PermissionRequestHookSpecificOutput,
  PermissionResult,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
  PostToolUseFailureHookInput,
  PostToolUseFailureHookSpecificOutput,
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PreCompactHookInput,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  Query,
  RewindFilesResult,
  SandboxIgnoreViolations,
  SandboxNetworkConfig,
  SandboxSettings,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKAuthStatusMessage,
  SDKCompactBoundaryMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKHookStartedMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDenial,
  SDKResultError,
  SDKResultMessage,
  SDKResultSuccess,
  SDKStatus,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKTaskNotificationMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SdkBeta,
  SdkMcpToolDefinition,
  SdkPluginConfig,
  SessionEndHookInput,
  SessionStartHookInput,
  SessionStartHookSpecificOutput,
  SettingSource,
  SetupHookInput,
  SetupHookSpecificOutput,
  SlashCommand,
  SpawnedProcess,
  SpawnOptions,
  StopHookInput,
  SubagentStartHookInput,
  SubagentStartHookSpecificOutput,
  SubagentStopHookInput,
  SyncHookJSONOutput,
  UserPromptSubmitHookInput,
  UserPromptSubmitHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
// Values
export {
  AbortError,
  createSdkMcpServer,
  EXIT_REASONS,
  HOOK_EVENTS,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
