# Raysurfer TypeScript SDK

Drop-in replacement for Claude Agent SDK with automatic code caching.

## Quick Start

Simply swap your import:

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
    model: "claude-sonnet-4-5",
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
  model: "claude-sonnet-4-5",
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

const client = new RaySurfer({
  apiKey: "rs_...",
  publicSnips: true,
  snipsDesired: "company",
});

// Store a code block
await client.storeCodeBlock({
  name: "GitHub User Fetcher",
  source: "function fetchUser(username) { ... }",
  entrypoint: "fetchUser",
  language: "typescript",
});

// Retrieve code blocks
const response = await client.retrieve({ task: "Fetch GitHub user data" });
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

## Documentation Sync

When making changes to this package, check `docs/` at the repo root to see if documentation needs updating.
