/**
 * High-level Agent runner with automatic code caching and
 * AI-driven quality scoring.
 */

import RaySurfer from "./client";

export interface MessageParam {
  role: "user" | "assistant";
  content: string;
}

export interface AgentOptions {
  orgId?: string;
  userId?: string;
  apiKey?: string;
  baseUrl?: string;
  agentId?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  model?: string;
}

export interface RunResult {
  runId: string;
  query: string;
  succeeded: boolean;
  messages: unknown[];
  codeUsed: Array<{
    code_block_id: string;
    filename?: string;
    description?: string;
  }>;
}

/**
 * Conversation runner with automatic code caching and
 * AI-driven quality scoring.
 *
 * Wraps raysurfer.search() and raysurfer.upload() into a
 * single run() call. Accepts Anthropic-typed chat history,
 * searches for proven cached code, executes via Claude with
 * that code injected, and stores any new code generated.
 * AI automatically scores code quality — no manual feedback
 * needed.
 *
 * @example
 * ```typescript
 * import { Agent } from "raysurfer";
 *
 * const agent = new Agent({
 *   orgId: "acme-corp",
 *   userId: "user_123",
 * });
 * const result = await agent.run([
 *   { role: "user", content: "Generate a quarterly report" },
 * ]);
 * ```
 */
export class Agent {
  private readonly _orgId: string | undefined;
  private readonly _userId: string | undefined;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string | undefined;
  private readonly _agentId: string | undefined;
  private readonly _allowedTools: string[];
  private readonly _systemPrompt: string;
  private readonly _model: string | undefined;
  private _raysurfer: RaySurfer | undefined;

  constructor(options: AgentOptions = {}) {
    this._orgId = options.orgId;
    this._userId = options.userId;
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl;
    this._agentId = options.agentId;
    this._allowedTools = options.allowedTools ?? [
      "Read",
      "Write",
      "Bash",
    ];
    this._systemPrompt =
      options.systemPrompt ?? "You are a helpful assistant.";
    this._model = options.model;
  }

  /**
   * Initialize the underlying raysurfer client. Call this
   * before run() if not using the static create() helper.
   */
  async init(): Promise<this> {
    this._raysurfer = new RaySurfer({
      apiKey: this._apiKey,
      baseUrl: this._baseUrl,
      organizationId: this._orgId,
      snipsDesired: this._orgId ? "company" : undefined,
      agentId: this._agentId,
    });
    return this;
  }

  /**
   * Process a conversation with automatic code caching.
   *
   * Each conversation goes through the raysurfer loop:
   * 1. raysurfer.search() — find proven cached code
   * 2. Execute via Claude with cached code as context
   * 3. raysurfer.upload() — store new code for reuse
   *
   * AI automatically scores code quality on execution —
   * no manual feedback needed.
   */
  async run(
    messages: MessageParam[],
    _options: { userId?: string; orgId?: string } = {},
  ): Promise<RunResult> {
    if (!this._raysurfer) {
      await this.init();
    }
    const rs = this._raysurfer;
    if (!rs) {
      throw new Error("Failed to initialize raysurfer client.");
    }

    // Extract last user message as the search query
    const lastUserMsg = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMsg) {
      throw new Error(
        "Messages must contain at least one user message.",
      );
    }
    const query = lastUserMsg.content;
    const runId = crypto.randomUUID();

    // 1. Search for cached code
    const searchResult = await rs.search({ task: query });
    const codeUsed: RunResult["codeUsed"] =
      searchResult.matches?.map((m) => ({
        code_block_id: m.codeBlock.id,
        filename: m.codeBlock.name,
        description: m.codeBlock.description,
      })) ?? [];

    // 2. Execute via Claude with cached code injected
    let succeeded = false;
    const responseMessages: unknown[] = [];

    try {
      const { query: sdkQuery } = await import("./sdk-client");
      for await (const msg of sdkQuery({
        prompt: query,
        options: {
          allowedTools: this._allowedTools,
          systemPrompt: this._systemPrompt,
          model: this._model,
        },
      })) {
        responseMessages.push(msg);
        if (
          typeof msg === "object" &&
          msg !== null &&
          "type" in msg &&
          (msg as Record<string, unknown>).type === "result" &&
          "subtype" in msg &&
          (msg as Record<string, unknown>).subtype === "success"
        ) {
          succeeded = true;
        }
      }
    } catch {
      succeeded = false;
    }

    return {
      runId,
      query,
      succeeded,
      messages: responseMessages,
      codeUsed,
    };
  }
}
