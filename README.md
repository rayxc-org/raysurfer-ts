# RaySurfer TypeScript SDK

Drop-in replacement for Claude Agent SDK with automatic code caching.

## Installation

```bash
npm install raysurfer
```

## Setup

Set your API key:

```bash
export RAYSURFER_API_KEY=your_api_key_here
```

Get your key from the [dashboard](https://raysurfer.com/dashboard/api-keys).

## Usage

Swap your import — everything else stays the same:

```typescript
// Before
import { query } from "@anthropic-ai/claude-agent-sdk";

// After
import { query } from "raysurfer";

for await (const message of query({
  prompt: "Fetch data from GitHub API",
  options: {
    model: "claude-opus-4-5-20250514",
    systemPrompt: "You are a helpful assistant.",
  },
})) {
  console.log(message);
}
```

All Claude SDK types are re-exported from `raysurfer`, so you don't need a
separate import:

```typescript
import {
  query,
  type Options,
  type SDKMessage,
  type Query,
} from "raysurfer";
```

## How It Works

1. **On query**: Retrieves cached code blocks matching your task
2. **Injects into prompt**: Agent sees proven code snippets
3. **After success**: New code is cached for next time

Caching is enabled automatically when `RAYSURFER_API_KEY` is set. Without it,
behaves exactly like the original SDK.

## Class-based API

```typescript
import { ClaudeSDKClient } from "raysurfer";

const client = new ClaudeSDKClient({
  model: "claude-opus-4-5-20250514",
  systemPrompt: "You are a helpful assistant.",
});

for await (const msg of client.query("Fetch data from GitHub API")) {
  console.log(msg);
}
```

## System Prompt Preset

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

## Query Control Methods

The `query()` function returns a `Query` object with full control methods:

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

## Low-Level API

For custom integrations, use the `RaySurfer` client directly:

```typescript
import { RaySurfer } from "raysurfer";

const client = new RaySurfer({ apiKey: "your_api_key" });

// 1. Get cached code snippets for a task
const snips = await client.getCodeSnips({
  task: "Fetch GitHub trending repos",
});
for (const match of snips.codeBlocks) {
  console.log(`${match.codeBlock.name}: ${match.score}`);
}

// Or use the unified search endpoint
const searchResult = await client.search({
  task: "Fetch GitHub trending repos",
});
for (const match of searchResult.matches) {
  console.log(`${match.codeBlock.name}: ${match.combinedScore}`);
}

// 2. Upload a new code file after execution
await client.uploadNewCodeSnip(
  "Fetch GitHub trending repos",
  { path: "fetch_repos.ts", content: "function fetch() { ... }" },
  true // succeeded
);

// 2b. Bulk upload prompts/logs/code for sandboxed grading
await client.uploadBulkCodeSnips(
  ["Build a CLI tool", "Add CSV support"],
  [{ path: "cli.ts", content: "function main() { ... }" }],
  [{ path: "logs/run.log", content: "Task completed", encoding: "utf-8" }],
  true
);

// 3. Vote on whether a cached snippet was useful
await client.voteCodeSnip({
  task: "Fetch GitHub trending repos",
  codeBlockId: "abc123",
  codeBlockName: "github_fetcher",
  codeBlockDescription: "Fetches trending repos from GitHub",
  succeeded: true,
});
```

## License

MIT
