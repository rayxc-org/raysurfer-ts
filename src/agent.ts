import RaySurfer, { type RaySurferOptions } from "./client";
import type { ExecuteResult, ToolCallback, ToolDefinition } from "./types";

const DEFAULT_CODEGEN_MODEL = "claude-opus-4-6";
const DEFAULT_EXECUTION_TIMEOUT_MS = 300000;
const CODEGEN_DOCS_URL =
  "https://docs.raysurfer.com/sdk/typescript#programmatic-tool-calling";

export interface CodegenAppOptions extends RaySurferOptions {
  raysurfer?: RaySurfer;
  codegenApiKey?: string;
  codegenModel?: string;
  executionTimeoutMs?: number;
}

export interface CodegenRunOptions {
  codegenPrompt?: string;
  codegenApiKey?: string;
  codegenModel?: string;
  executionTimeoutMs?: number;
}

export interface CodegenRunGeneratedCodeOptions {
  executionTimeoutMs?: number;
}

function missingCodegenKeyError(value: unknown): Error {
  return new Error(
    `Invalid codegenApiKey value: ${String(value)}. Expected format: non-empty provider API key string. ` +
      "Current tier/state: tier=unknown, codegen_api_key_missing=true (not configured on app and not provided at call-time). " +
      `Fix: pass codegenApiKey in app config or run(...). Docs: ${CODEGEN_DOCS_URL}`,
  );
}

function invalidCodegenPromptError(value: unknown): Error {
  return new Error(
    `Invalid codegenPrompt value: ${String(value)}. Expected format: non-empty prompt string. ` +
      "Current tier/state: tier=unknown, codegen_prompt_invalid=true. " +
      `Fix: pass codegenPrompt or provide a non-empty task. Docs: ${CODEGEN_DOCS_URL}`,
  );
}

export class CodegenApp {
  private readonly _raysurfer: RaySurfer;
  private readonly _defaultCodegenApiKey: string | undefined;
  private readonly _defaultCodegenModel: string;
  private readonly _defaultExecutionTimeoutMs: number;

  constructor(options: CodegenAppOptions = {}) {
    const {
      raysurfer,
      codegenApiKey,
      codegenModel,
      executionTimeoutMs,
      ...clientOptions
    } = options;
    this._raysurfer = raysurfer ?? new RaySurfer(clientOptions);
    this._defaultCodegenApiKey = codegenApiKey;
    this._defaultCodegenModel = codegenModel ?? DEFAULT_CODEGEN_MODEL;
    this._defaultExecutionTimeoutMs =
      executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  }

  get raysurfer(): RaySurfer {
    return this._raysurfer;
  }

  tool(
    name: string,
    description: string,
    parameters: ToolDefinition["parameters"],
    callback: ToolCallback,
  ): this {
    this._raysurfer.tool(name, description, parameters, callback);
    return this;
  }

  async run(
    task: string,
    options: CodegenRunOptions = {},
  ): Promise<ExecuteResult> {
    const codegenApiKey = this.resolveCodegenApiKey(options.codegenApiKey);
    const codegenPrompt = this.resolveCodegenPrompt(
      task,
      options.codegenPrompt,
    );
    const codegenModel = options.codegenModel ?? this._defaultCodegenModel;
    const timeout =
      options.executionTimeoutMs ?? this._defaultExecutionTimeoutMs;
    return this._raysurfer.executeWithSandboxCodegen(
      task,
      {
        provider: "anthropic",
        apiKey: codegenApiKey,
        prompt: codegenPrompt,
        model: codegenModel,
      },
      { timeout },
    );
  }

  async runGeneratedCode(
    task: string,
    userCode: string,
    options: CodegenRunGeneratedCodeOptions = {},
  ): Promise<ExecuteResult> {
    const timeout =
      options.executionTimeoutMs ?? this._defaultExecutionTimeoutMs;
    return this._raysurfer.executeGeneratedCode(task, userCode, { timeout });
  }

  private resolveCodegenApiKey(codegenApiKey?: string): string {
    const value = codegenApiKey ?? this._defaultCodegenApiKey;
    if (typeof value === "string") {
      const stripped = value.trim();
      if (stripped.length > 0) {
        return stripped;
      }
    }
    throw missingCodegenKeyError(value);
  }

  private resolveCodegenPrompt(task: string, codegenPrompt?: string): string {
    const value = codegenPrompt ?? task;
    if (typeof value === "string") {
      const stripped = value.trim();
      if (stripped.length > 0) {
        return stripped;
      }
    }
    throw invalidCodegenPromptError(value);
  }
}
