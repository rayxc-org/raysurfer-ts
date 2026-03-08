/**
 * High-level Agent runner for batch query execution with
 * retroactive voting.
 */

import RaySurfer from "./client";

export interface AgentOptions {
  orgId?: string;
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
 * Batch query runner with automatic code persistence and
 * retroactive voting.
 *
 * Wraps raysurfer.search() and raysurfer.upload() into a
 * single run() call. For each query, searches for proven
 * cached code, executes via Claude with that code injected,
 * and stores any new code generated. Tracks which cached
 * snippets contributed to each result so user feedback can
 * retroactively promote or demote them.
 *
 * @example
 * ```typescript
 * import { Agent } from "raysurfer";
 *
 * const agent = new Agent({ orgId: "acme-corp" });
 * const results = await agent.run(
 *   ["Generate quarterly report", "Summarize sales data"],
 *   { userId: "user_123" },
 * );
 *
 * // User liked the first result, disliked the second
 * await agent.feedback(results[0].runId, true);
 * await agent.feedback(results[1].runId, false);
 * ```
 */
export class Agent {
  private readonly _orgId: string | undefined;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string | undefined;
  private readonly _agentId: string | undefined;
  private readonly _allowedTools: string[];
  private readonly _systemPrompt: string;
  private readonly _model: string | undefined;
  private readonly _runLog = new Map<string, RunResult>();
  private _raysurfer: RaySurfer | undefined;

  constructor(options: AgentOptions = {}) {
    this._orgId = options.orgId;
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl;
    this._agentId = options.agentId;
    this._allowedTools = options.allowedTools ?? ["Read", "Write", "Bash"];
    this._systemPrompt = options.systemPrompt ?? "You are a helpful assistant.";
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
   * Process a batch of user queries with automatic code
   * caching.
   *
   * Each query goes through the raysurfer loop:
   * 1. raysurfer.search() — find proven cached code
   * 2. Execute via Claude with cached code as context
   * 3. raysurfer.upload() — store new code for reuse
   *
   * Returns RunResult objects with runIds for retroactive
   * feedback.
   */
  async run(
    userQueries: string[],
    _options: { userId?: string; orgId?: string } = {},
  ): Promise<RunResult[]> {
    if (!this._raysurfer) {
      await this.init();
    }
    const rs = this._raysurfer;
    if (!rs) {
      throw new Error("Failed to initialize raysurfer client.");
    }

    const results: RunResult[] = [];
    for (const query of userQueries) {
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
      // The RaysurferClient handles injection + upload
      // automatically — for the TS SDK we use the query()
      // function which wraps the Claude Agent SDK.
      let succeeded = false;
      const messages: unknown[] = [];

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
          messages.push(msg);
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

      const result: RunResult = {
        runId,
        query,
        succeeded,
        messages,
        codeUsed,
      };
      this._runLog.set(runId, result);
      results.push(result);
    }

    return results;
  }

  /**
   * Retroactively vote on all code that contributed to a
   * run result.
   *
   * Satisfied = thumbs up on every cached snippet used.
   * Dissatisfied = thumbs down. Over time this promotes
   * code that makes users happy and demotes code that
   * doesn't.
   */
  async feedback(runId: string, satisfied: boolean): Promise<void> {
    const result = this._runLog.get(runId);
    if (!result) {
      throw new Error(
        `Unknown runId: ${runId}. ` +
          "Run IDs are only valid within the same Agent " +
          "session.",
      );
    }

    if (!this._raysurfer) {
      throw new Error("Agent is not initialized. Call init() first.");
    }

    const rs = this._raysurfer;
    await Promise.all(
      result.codeUsed.map((block) =>
        rs.voteCodeSnip({
          task: result.query,
          codeBlockId: block.code_block_id,
          codeBlockName: block.filename ?? "",
          codeBlockDescription: block.description ?? "",
          succeeded: satisfied,
        }),
      ),
    );
  }
}
