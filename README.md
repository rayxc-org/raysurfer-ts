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

Swap your client class and method names. Options come directly from `@anthropic-ai/claude-agent-sdk`:

```typescript
// Before
import { ClaudeSDKClient, ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

// After
import { RaysurferClient } from "raysurfer";
import { ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

const options: ClaudeAgentOptions = {
  allowedTools: ["Read", "Write", "Bash"],
  systemPrompt: "You are a helpful assistant.",
};

const client = new RaysurferClient(options);

for await (const msg of client.raysurferQuery("Generate quarterly report")) {
  console.log(msg);
}
```

## Method Mapping

| Claude SDK | Raysurfer |
|------------|-----------|
| `new ClaudeSDKClient(options)` | `new RaysurferClient(options)` |
| `client.query(prompt)` | `client.raysurferQuery(prompt)` |

## How It Works

1. **On `raysurferQuery()`**: Retrieves cached code blocks matching your task
2. **Downloads to sandbox**: Files ready for the agent to execute
3. **Injects into prompt**: Agent sees proven code snippets
4. **After success**: New code is cached for next time

Caching is enabled automatically when `RAYSURFER_API_KEY` is set.

## Snippet Retrieval Scope

Control which cached snippets are retrieved using `publicSnips` and `snipsDesired`:

```typescript
import { RaysurferClient } from "raysurfer";
import { ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

const options: ClaudeAgentOptions = {
  allowedTools: ["Read", "Write", "Bash"],
};

// Include both public and company snippets
const client = new RaysurferClient(options, {
  publicSnips: true,        // Include public/shared snippets
  snipsDesired: "company",  // Also include company-level snippets
});

// Enterprise: Retrieve client-specific snippets only
const enterpriseClient = new RaysurferClient(options, {
  snipsDesired: "client",   // Client workspace snippets (Enterprise only)
});
```

| Configuration | Required Tier |
|--------------|---------------|
| `publicSnips: true` only | FREE (default) |
| `snipsDesired: "company"` | TEAM or ENTERPRISE |
| `snipsDesired: "client"` | ENTERPRISE only |

## Full Example

```typescript
import { RaysurferClient } from "raysurfer";
import { ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

process.env.RAYSURFER_API_KEY = "your_api_key";

const options: ClaudeAgentOptions = {
  allowedTools: ["Read", "Write", "Bash"],
  systemPrompt: "You are a helpful assistant.",
};

const client = new RaysurferClient(options);

// First run: generates and caches code
for await (const msg of client.raysurferQuery("Fetch GitHub trending repos")) {
  console.log(msg);
}

// Second run: retrieves from cache (instant)
for await (const msg of client.raysurferQuery("Fetch GitHub trending repos")) {
  console.log(msg);
}
```

## Without Caching

If `RAYSURFER_API_KEY` is not set, `RaysurferClient` behaves exactly like `ClaudeSDKClient` — no caching, just a pass-through wrapper.

## Low-Level API

For custom integrations, use the `RaySurfer` client directly with three core methods:

```typescript
import { RaySurfer } from "raysurfer";

const client = new RaySurfer({ apiKey: "your_api_key" });

// 1. Get cached code snippets for a task
const snips = await client.getCodeSnips({ task: "Fetch GitHub trending repos" });
for (const match of snips.codeBlocks) {
  console.log(`${match.codeBlock.name}: ${match.score}`);
}

// 2. Upload new code snippets after execution
await client.uploadNewCodeSnips(
  "Fetch GitHub trending repos",
  [{ filename: "fetch_repos.ts", content: "function fetch() { ... }" }],
  true // succeeded
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

### Method Reference

| Method | Description |
|--------|-------------|
| `getCodeSnips({ task, topK?, minVerdictScore? })` | Retrieve cached code snippets by semantic search |
| `uploadNewCodeSnips(task, filesWritten, succeeded)` | Store new code files for future reuse |
| `voteCodeSnip({ task, codeBlockId, codeBlockName, codeBlockDescription, succeeded })` | Vote on snippet usefulness |

## License

MIT
