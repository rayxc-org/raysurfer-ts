/**
 * Agent-accessible function decorator for Raysurfer.
 */

import type { RaySurfer } from "./client";
import type { JsonValue } from "./types";

/** Metadata attached to agent-accessible functions */
export interface AgentAccessibleSchema {
  name: string;
  description: string;
  parameters: Record<string, JsonValue>;
  source: string;
}

/** A function marked as agent-accessible */
export type AgentAccessibleFunction<T extends (...args: never[]) => unknown> =
  T & {
    _raysurferAccessible: true;
    _raysurferSchema: AgentAccessibleSchema;
  };

/**
 * Mark a function as callable by agents and attach metadata.
 */
export function agentAccessible<T extends (...args: never[]) => unknown>(
  fn: T,
  options: {
    name: string;
    description: string;
    parameters: Record<string, JsonValue>;
  },
): AgentAccessibleFunction<T> {
  const marked = fn as AgentAccessibleFunction<T>;
  marked._raysurferAccessible = true;
  marked._raysurferSchema = {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    source: fn.toString(),
  };
  return marked;
}

/**
 * Batch-upload agent-accessible functions as code blocks to Raysurfer.
 * Returns list of snippet names for the uploaded functions.
 */
export async function publishFunctionRegistry(
  client: RaySurfer,
  functions: AgentAccessibleFunction<(...args: never[]) => unknown>[],
): Promise<string[]> {
  const snippetNames: string[] = [];
  for (const fn of functions) {
    if (!fn._raysurferAccessible) continue;
    const schema = fn._raysurferSchema;
    const resp = await client.uploadNewCodeSnip(
      `Call ${schema.name}: ${schema.description}`,
      { path: `${schema.name}.ts`, content: schema.source },
      true, // succeeded
      undefined, // cachedCodeBlocks
      false, // useRaysurferAiVoting
    );
    if (resp.snippetName) {
      snippetNames.push(resp.snippetName);
    }
  }
  return snippetNames;
}
