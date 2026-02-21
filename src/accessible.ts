/**
 * Agent-accessible function decorator and registry helpers for Raysurfer.
 */

import type { RaySurfer } from "./client";
import type { JsonValue } from "./types";
import { ExecutionState } from "./types";

type JsonLike = JsonValue | { [key: string]: JsonLike } | JsonLike[];

type AccessibleReturn = JsonLike | object | Promise<JsonLike | object>;
type AccessibleArgs = Array<JsonLike | object>;
export type AgentCallable = (...args: AccessibleArgs) => AccessibleReturn;

/** Metadata attached to agent-accessible functions */
export interface AgentAccessibleSchema {
  name: string;
  description: string;
  inputSchema: Record<string, JsonValue>;
  /** @deprecated Use inputSchema instead */
  parameters: Record<string, JsonValue>;
  source: string;
  codeBlockId?: string;
}

/** A function marked as agent-accessible */
export type AgentAccessibleFunction<T extends AgentCallable> = T & {
  _raysurferAccessible: true;
  _raysurferSchema: AgentAccessibleSchema;
  _raysurferClient?: RaySurfer;
};

function toJsonLike(value: JsonLike | object | undefined): JsonLike {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonLike(item as JsonLike | object));
  }
  if (typeof value === "object") {
    const result: { [key: string]: JsonLike } = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, JsonLike | object>,
    )) {
      result[key] = toJsonLike(nested);
    }
    return result;
  }
  return String(value);
}

function queueUsageTracking(
  fn: AgentAccessibleFunction<AgentCallable>,
  args: AccessibleArgs,
  result: JsonLike | object,
  durationMs: number,
  errorMessage?: string,
): void {
  const client = fn._raysurferClient;
  if (!client) return;

  const codeBlockId =
    fn._raysurferSchema.codeBlockId ??
    `function_registry:${fn._raysurferSchema.name}`;
  const outputData: JsonLike | object =
    errorMessage === undefined ? result : { error: errorMessage };

  void client
    .storeExecution({
      codeBlockId,
      triggeringTask: `agent_accessible:${fn._raysurferSchema.name}`,
      inputData: {
        args: toJsonLike(args),
      },
      outputData: toJsonLike(outputData),
      executionState: errorMessage
        ? ExecutionState.ERRORED
        : ExecutionState.COMPLETED,
      durationMs,
      errorMessage,
    })
    .catch(() => {
      // Usage tracking is best-effort and should not break user code paths.
    });
}

/**
 * Extract parameter names from a function's toString() representation.
 * Best-effort: all inferred types default to "string".
 */
function inferParameters(fn: AgentCallable): Record<string, JsonValue> {
  const src = fn.toString();
  const match = /^[^(]*\(([^)]*)\)/.exec(src);
  const paramStr = match?.[1];
  if (!paramStr?.trim()) return {};
  const params: Record<string, JsonValue> = {};
  const parts = paramStr.split(",");
  for (const part of parts) {
    const cleaned = part
      .trim()
      .replace(/\/\*.*?\*\//g, "")
      .replace(/=.*$/, "")
      .replace(/:.*$/, "")
      .trim();
    if (cleaned && cleaned !== "..." && !cleaned.startsWith("...")) {
      params[cleaned] = "string";
    }
  }
  return params;
}

/**
 * Mark a function as callable by agents and attach metadata.
 * All options are optional — name and parameters are auto-inferred
 * from the function when not provided.
 */
export function agentAccessible<T extends AgentCallable>(
  fn: T,
  options?: {
    name?: string;
    description?: string;
    inputSchema?: Record<string, JsonValue>;
    /** @deprecated Use inputSchema instead */
    parameters?: Record<string, JsonValue>;
    orgId?: string;
    workspaceId?: string;
  },
): AgentAccessibleFunction<T> {
  const resolvedName = options?.name ?? fn.name ?? "anonymous";
  const resolvedDescription = options?.description ?? "";
  const resolvedSchema =
    options?.inputSchema ?? options?.parameters ?? inferParameters(fn);

  let marked: AgentAccessibleFunction<T>;
  const wrapped = (...args: Parameters<T>): AccessibleReturn => {
    const started = Date.now();
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        const trackedPromise = result
          .then((resolved) => {
            queueUsageTracking(
              marked as AgentAccessibleFunction<
                (...args: AccessibleArgs) => AccessibleReturn
              >,
              args,
              resolved as JsonLike | object,
              Date.now() - started,
            );
            return resolved;
          })
          .catch((error: Error | string) => {
            const message =
              error instanceof Error ? error.message : String(error);
            queueUsageTracking(
              marked as AgentAccessibleFunction<
                (...args: AccessibleArgs) => AccessibleReturn
              >,
              args,
              null,
              Date.now() - started,
              message,
            );
            throw error;
          });
        return trackedPromise as ReturnType<T>;
      }
      queueUsageTracking(
        marked as AgentAccessibleFunction<
          (...args: AccessibleArgs) => AccessibleReturn
        >,
        args,
        result as JsonLike | object,
        Date.now() - started,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queueUsageTracking(
        marked as AgentAccessibleFunction<
          (...args: AccessibleArgs) => AccessibleReturn
        >,
        args,
        null,
        Date.now() - started,
        message,
      );
      throw error;
    }
  };

  marked = wrapped as AgentAccessibleFunction<T>;
  marked._raysurferAccessible = true;
  marked._raysurferSchema = {
    name: resolvedName,
    description: resolvedDescription,
    inputSchema: resolvedSchema,
    parameters: resolvedSchema,
    source: fn.toString(),
  };
  return marked;
}

/**
 * Convert an agent-accessible function to an Anthropic tool definition.
 */
export function toAnthropicTool(fn: AgentAccessibleFunction<AgentCallable>): {
  name: string;
  description: string;
  input_schema: Record<string, JsonValue>;
} {
  const schema = fn._raysurferSchema;
  return {
    name: schema.name,
    description: schema.description,
    input_schema: schema.inputSchema,
  };
}

/**
 * Batch-upload agent-accessible functions as code blocks to Raysurfer.
 * Returns list of snippet names for the uploaded functions.
 */
export async function publishFunctionRegistry(
  client: RaySurfer,
  functions: AgentAccessibleFunction<AgentCallable>[],
): Promise<string[]> {
  const snippetNames: string[] = [];
  for (const fn of functions) {
    if (!fn._raysurferAccessible) continue;
    const schema = fn._raysurferSchema;
    const resp = await client.uploadNewCodeSnip({
      task: `Call ${schema.name}: ${schema.description}`,
      fileWritten: { path: `${schema.name}.ts`, content: schema.source },
      succeeded: true,
      useRaysurferAiVoting: false,
      tags: ["function_registry", "agent_accessible"],
    });
    if (resp.snippetName) {
      snippetNames.push(resp.snippetName);
      schema.codeBlockId = resp.snippetName;
    }
    setTrackingClient(fn, client);
  }
  return snippetNames;
}

/**
 * Attach a Raysurfer client to a decorated function for usage tracking.
 */
export function setTrackingClient(
  fn: AgentAccessibleFunction<AgentCallable>,
  client: RaySurfer,
): void {
  fn._raysurferClient = client;
}
