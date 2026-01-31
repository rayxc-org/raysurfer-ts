# Raysurfer TypeScript SDK

Drop-in replacement for Claude Agent SDK with automatic code caching.

## Quick Start

Two modes: high-level drop-in replacement for Claude Agent SDK, and low-level API for snippet pull/upload/vote.

```typescript
// Before
import { query } from "@anthropic-ai/claude-agent-sdk";

// After
import { query } from "raysurfer";
```

Set the `RAYSURFER_API_KEY` environment variable to enable caching. Everything else works exactly the same.

## How It Works

1. **On query**: Automatically retrieves relevant cached code and injects it into the system prompt
2. **On success**: Automatically uploads generated code to the cache for future reuse
3. **No caching?**: If `RAYSURFER_API_KEY` isn't set, behaves exactly like the original SDK

## Example

```typescript
import { query } from "raysurfer";

process.env.RAYSURFER_API_KEY = "rs_...";

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

## Class-based API

For users who prefer a class-based interface:

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

## Direct API Access

For advanced use cases, use the low-level client:

```typescript
import { RaySurfer } from "raysurfer";

const client = new RaySurfer({ apiKey: "rs_..." });

// Pull: retrieve cached code by user query
const result = await client.getCodeFiles({ task: "Fetch GitHub user data" });

// Upload: store code + logs + query (voting triggered by default)
await client.uploadNewCodeSnips(
  "Fetch GitHub user data",
  [{ path: "fetcher.ts", content: "function fetch() { ... }" }],
  true,     // succeeded
  undefined, // cachedCodeBlocks
  true,     // autoVote
  "Fetched user data successfully", // executionLogs
);
```

## Package Managers

Use `bun` for all TypeScript operations.

## Before Completing Tasks

Run `bun run lint` before marking a task as completed or pushing to git/npm.

## Building

```bash
bun run build
```

## Publishing

In order to publish updates for the npm package, run `bun publish`.

```bash
bun publish
```

## Documentation Style

Wrap all documentation (README, CLAUDE.md, etc.) at 78 characters per line.
Code blocks can exceed this when necessary for readability.

## Documentation Sync

When making changes to this package, check `docs/` at the repo root to see if
documentation needs updating.
