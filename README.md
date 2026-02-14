# RaySurfer TypeScript SDK

[Website](https://raysurfer.com) · [Docs](https://docs.raysurfer.com) · [Dashboard](https://raysurfer.com/dashboard/api-keys)

<!-- Old: LLM output caching for AI agents. Retrieve proven code instead of regenerating it. -->
<!-- Old: Code reputation layer for AI agents. Let agents re-use generated code vs running 30 serial tools or generating code per execution. -->
AI Maintained Skills for Vertical Agents. Re-use verified code
from prior runs rather than serial tool calls or generating code
per execution.

## Installation

```bash
npm install raysurfer
```

## Setup

Set your API key:

```bash
export RAYSURFER_API_KEY=your_api_key_here
```

Get your key from the
[dashboard](https://raysurfer.com/dashboard/api-keys).

## Low-Level API

For custom integrations, use the `RaySurfer` client directly with
any LLM provider.

### Complete Example

```typescript
import { RaySurfer } from "raysurfer";

const client = new RaySurfer({ apiKey: "your_api_key" });
const task = "Fetch GitHub trending repos";

// 1. Search for cached code matching a task
const result = await client.search({
  task,
  topK: 5,
  minVerdictScore: 0.3,
});

for (const match of result.matches) {
  console.log(`${match.codeBlock.name}: ${match.combinedScore}`);
  console.log(`  Source: ${match.codeBlock.source.slice(0, 80)}...`);
}

// 2. Upload a new code file after execution
await client.uploadNewCodeSnip({
  task,
  fileWritten: {
    path: "fetch_repos.ts",
    content: "function fetch() { ... }",
  },
  succeeded: true,
  executionLogs: "Fetched 10 trending repos successfully",
  dependencies: { "node-fetch": "3.3.0", zod: "3.22.0" },
});

// 2b. Bulk upload prompts/logs/code for sandboxed grading
await client.uploadBulkCodeSnips(
  ["Build a CLI tool", "Add CSV support"],
  [{ path: "cli.ts", content: "function main() { ... }" }],
  [
    {
      path: "logs/run.log",
      content: "Task completed",
      encoding: "utf-8",
    },
  ]
);

// 3. Vote on whether a cached snippet was useful
await client.voteCodeSnip({
  task,
  codeBlockId: result.matches[0].codeBlock.id,
  codeBlockName: result.matches[0].codeBlock.name,
  codeBlockDescription: result.matches[0].codeBlock.description,
  succeeded: true,
});
```

### Client Options

```typescript
const client = new RaySurfer({
  apiKey: "your_api_key",
  baseUrl: "https://api.raysurfer.com", // optional
  timeout: 30000, // optional, in ms
  organizationId: "org_xxx", // optional, for team namespacing
  workspaceId: "ws_xxx", // optional, for enterprise namespacing
  snipsDesired: "company", // optional, snippet scope
  publicSnips: true, // optional, include community snippets
});
```

### Response Fields

The `search()` response includes:

| Field            | Type            | Description                       |
| ---------------- | --------------- | --------------------------------- |
| `matches`        | `SearchMatch[]` | Matching code blocks with scoring |
| `totalFound`     | `number`        | Total matches found               |
| `cacheHit`       | `boolean`       | Whether results were from cache   |

Each `SearchMatch` contains `codeBlock` (with `id`, `name`,
`source`, `description`, `entrypoint`, `language`, `dependencies`),
`combinedScore`, `vectorScore`, `verdictScore`, `thumbsUp`,
`thumbsDown`, `filename`, and `entrypoint`.

### Store a Code Block with Full Metadata

```typescript
const result = await client.storeCodeBlock({
  name: "GitHub User Fetcher",
  source: "function fetchUser(username) { ... }",
  entrypoint: "fetchUser",
  language: "typescript",
  description: "Fetches user data from GitHub API",
  tags: ["github", "api", "user"],
  dependencies: { "node-fetch": "3.3.0" },
});
```

### Retrieve Few-Shot Examples

```typescript
const examples = await client.getFewShotExamples(
  "Parse CSV files",
  3
);

for (const ex of examples) {
  console.log(`Task: ${ex.task}`);
  console.log(`Code: ${ex.codeSnippet}`);
}
```

### Retrieve Task Patterns

```typescript
const patterns = await client.getTaskPatterns({
  task: "API integration",
  minThumbsUp: 5,
  topK: 20,
});

for (const p of patterns) {
  console.log(`${p.taskPattern} -> ${p.codeBlockName}`);
}
```

### User-Provided Votes

Instead of relying on AI voting, provide your own votes:

```typescript
// Single upload with your own vote (AI voting is skipped)
await client.uploadNewCodeSnip({
  task: "Fetch GitHub trending repos",
  fileWritten: file,
  succeeded: true,
  userVote: 1, // 1 = thumbs up, -1 = thumbs down
});

// Bulk upload with per-file votes (AI grading is skipped)
await client.uploadBulkCodeSnips(
  ["Build a CLI tool", "Add CSV support"],
  files,
  logs,
  true, // useRaysurferAiVoting (ignored when userVotes set)
  { "app.ts": 1, "utils.ts": -1 } // userVotes
);
```

### Method Reference

| Method | Description |
|--------|-------------|
| `search({ task, topK?, minVerdictScore?, preferComplete?, inputSchema? })` | Search for cached code snippets |
| `getCodeSnips({ task, topK?, minVerdictScore? })` | Retrieve cached code snippets by semantic search |
| `retrieveBest({ task, topK?, minVerdictScore? })` | Retrieve the single best match |
| `getFewShotExamples(task, k)` | Retrieve few-shot examples for code generation prompting |
| `getTaskPatterns({ task, minThumbsUp?, topK? })` | Retrieve proven task-to-code mappings |
| `storeCodeBlock({ name, source, entrypoint, language, description, tags?, dependencies?, ... })` | Store a code block with full metadata |
| `uploadNewCodeSnip({ task, fileWritten, succeeded, useRaysurferAiVoting?, userVote?, executionLogs?, dependencies? })` | Store a single code file with optional dependency versions |
| `uploadBulkCodeSnips(prompts, filesWritten, logFiles?, useRaysurferAiVoting?, userVotes?)` | Bulk upload for grading (AI votes by default, or provide per-file votes) |
| `voteCodeSnip({ task, codeBlockId, codeBlockName, codeBlockDescription, succeeded })` | Vote on snippet usefulness |

### Exceptions

Both clients include built-in retry logic with exponential backoff
for transient failures (429, 5xx, network errors).

| Exception               | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `RaySurferError`        | Base exception for all Raysurfer errors              |
| `APIError`              | API returned an error response (includes `statusCode`) |
| `AuthenticationError`   | API key is invalid or missing                        |
| `CacheUnavailableError` | Cache backend is unreachable                         |
| `RateLimitError`        | Rate limit exceeded after retries (includes `retryAfter`) |
| `ValidationError`       | Request validation failed (includes `field`)         |

```typescript
import { RaySurfer, RateLimitError } from "raysurfer";

const client = new RaySurfer({ apiKey: "your_api_key" });

try {
  const result = await client.getCodeSnips({
    task: "Fetch GitHub repos",
  });
} catch (e) {
  if (e instanceof RateLimitError) {
    console.log(`Rate limited after retries: ${e.message}`);
    if (e.retryAfter) {
      console.log(`Try again in ${e.retryAfter}ms`);
    }
  }
}
```

---

## Claude Agent SDK Drop-in

Swap your import — everything else stays the same:

```typescript
// Before
import { query } from "@anthropic-ai/claude-agent-sdk";

// After
import { query } from "raysurfer";

for await (const message of query({
  prompt: "Fetch data from GitHub API",
  options: {
    model: "claude-opus-4-6",
    systemPrompt: "You are a helpful assistant.",
  },
})) {
  console.log(message);
}
```

All Claude SDK types are re-exported from `raysurfer`, so you don't
need a separate import:

```typescript
import {
  query,
  type Options,
  type SDKMessage,
  type Query,
} from "raysurfer";
```

### Class-based API

```typescript
import { ClaudeSDKClient } from "raysurfer";

const client = new ClaudeSDKClient({
  model: "claude-opus-4-6",
  systemPrompt: "You are a helpful assistant.",
});

for await (const msg of client.query("Fetch data from GitHub API")) {
  console.log(msg);
}
```

### System Prompt Preset

Use the Claude Code preset system prompt with appended instructions:

```typescript
for await (const message of query({
  prompt: "Refactor the auth module",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: "Always explain your reasoning.",
    },
  },
})) {
  console.log(message);
}
```

### Query Control Methods

The `query()` function returns a `Query` object with full control
methods:

```typescript
const q = query({ prompt: "Build a REST API" });

await q.interrupt();
await q.setPermissionMode("acceptEdits");
await q.setModel("claude-sonnet-4-5-20250929");
await q.setMaxThinkingTokens(4096);
const models = await q.supportedModels();
const info = await q.accountInfo();
q.close();
```

### Without Caching

If `RAYSURFER_API_KEY` is not set, behaves exactly like the original
SDK — no caching, just a pass-through wrapper.

## Snippet Retrieval Scope

Control which cached snippets are retrieved:

```typescript
import { ClaudeSDKClient } from "raysurfer";

// Include company-level snippets (Team/Enterprise)
const client = new ClaudeSDKClient({
  snipsDesired: "company",
});

// Enterprise: client-specific snippets only
const enterpriseClient = new ClaudeSDKClient({
  snipsDesired: "client",
});
```

| Configuration                | Required Tier       |
|------------------------------|---------------------|
| Default (public only)        | FREE                |
| `snipsDesired: "company"`    | TEAM or ENTERPRISE  |
| `snipsDesired: "client"`     | ENTERPRISE only     |

## Public Snippets

Include community public snippets (crawled from GitHub) in
retrieval results alongside your private snippets:

```typescript
// High-level
const client = new ClaudeSDKClient({ publicSnips: true });

// Low-level
const rs = new RaySurfer({ apiKey: "...", publicSnips: true });
```

## License

MIT
