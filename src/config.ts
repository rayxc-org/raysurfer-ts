/**
 * raysurfer.yaml loader for agent-accessible function discovery.
 */

import { readFileSync } from "node:fs";

import { agentAccessible } from "./accessible";
import type { AgentAccessibleFunction, AgentCallable } from "./accessible";
import type { JsonValue } from "./types";

export interface AgentAccessRules {
  read: string[];
  call: string[];
  deny: string[];
}

export interface RaysurferConfig {
  agent_access: AgentAccessRules;
}

type ConfigFunction = AgentCallable;

export type ModuleFunctionMap = Record<
  string,
  Record<string, ConfigFunction>
>;

function coerceStringList(value: string[] | string | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  return [];
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseInlineList(raw: string): string[] {
  const content = raw.trim();
  if (!content.startsWith("[") || !content.endsWith("]")) {
    return [stripQuotes(content)];
  }
  const inner = content.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
}

function parseMinimalYaml(text: string): RaysurferConfig {
  const config: RaysurferConfig = {
    agent_access: { read: [], call: [], deny: [] },
  };

  let inAgentAccess = false;
  let currentList: keyof AgentAccessRules | null = null;

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent === 0) {
      inAgentAccess = trimmed === "agent_access:";
      currentList = null;
      continue;
    }
    if (!inAgentAccess) continue;

    if (indent <= 2 && trimmed.includes(":")) {
      const [rawKey, ...rest] = trimmed.split(":");
      const keyCandidate = rawKey?.trim();
      if (
        !keyCandidate ||
        (keyCandidate !== "read" &&
          keyCandidate !== "call" &&
          keyCandidate !== "deny")
      ) {
        currentList = null;
        continue;
      }
      const key = keyCandidate as keyof AgentAccessRules;
      const rawValue = rest.join(":").trim();
      if (rawValue.length === 0) {
        config.agent_access[key] = [];
        currentList = key;
      } else {
        config.agent_access[key] = parseInlineList(rawValue);
        currentList = null;
      }
      continue;
    }

    if (currentList && trimmed.startsWith("- ")) {
      config.agent_access[currentList].push(stripQuotes(trimmed.slice(2)));
    }
  }

  return config;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let regex = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i] ?? "";
    if (char.length === 0) continue;
    if (char === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        regex += ".*";
        i += 1;
      } else {
        regex += ".*";
      }
    } else if (char === "?") {
      regex += ".";
    } else {
      regex += escapeRegex(char);
    }
  }
  return new RegExp(`^${regex}$`);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(value));
}

function inferParameters(fn: ConfigFunction): Record<string, JsonValue> {
  const source = fn.toString().trim();
  const parenMatch = source.match(/^[^(]*\(([^)]*)\)/);
  const arrowMatch = source.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/);

  let rawParams = "";
  if (parenMatch && parenMatch[1] !== undefined) {
    rawParams = parenMatch[1];
  } else if (arrowMatch && arrowMatch[1] !== undefined) {
    rawParams = arrowMatch[1];
  }

  const params: Record<string, JsonValue> = {};
  for (const chunk of rawParams.split(",")) {
    const candidate = (
      chunk.trim().replace(/^\.\.\./, "").split("=")[0] ?? ""
    ).trim();
    if (!candidate) continue;
    params[candidate] = "string";
  }
  return params;
}

/**
 * Load raysurfer.yaml, discover matching functions, and mark them agent-accessible.
 */
export function loadConfig(
  path: string,
  modules: ModuleFunctionMap,
): AgentAccessibleFunction<ConfigFunction>[] {
  const text = readFileSync(path, "utf-8");
  const config = parseMinimalYaml(text);
  const callPatterns = coerceStringList(config.agent_access.call);
  const denyPatterns = coerceStringList(config.agent_access.deny);

  const functions: AgentAccessibleFunction<ConfigFunction>[] = [];

  for (const [modulePath, exportsMap] of Object.entries(modules)) {
    const normalizedModulePath = normalizePath(modulePath);
    for (const [name, fn] of Object.entries(exportsMap)) {
      const selector = `${normalizedModulePath}:${name}`;
      if (callPatterns.length > 0 && !matchesAny(selector, callPatterns)) {
        continue;
      }
      if (
        matchesAny(normalizedModulePath, denyPatterns) ||
        matchesAny(selector, denyPatterns)
      ) {
        continue;
      }

      const alreadyAccessible = Boolean(
        (fn as AgentAccessibleFunction<ConfigFunction>)._raysurferAccessible,
      );
      if (alreadyAccessible) {
        functions.push(fn as AgentAccessibleFunction<ConfigFunction>);
        continue;
      }

      functions.push(
        agentAccessible(fn, {
          name,
          description: "",
          parameters: inferParameters(fn),
        }),
      );
    }
  }

  return functions;
}
