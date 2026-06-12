# Scira CLI

![Scira CLI](./docs/public/cli-demo.png)

Terminal-native AI research and coding agent. Ask a question, get a grounded report with cited sources and verified claims — all stored locally and inspectable.

**Documentation:** [docs site](./docs) (local: `cd docs && bun run dev`) · MDX sources in `docs/content/docs/`

## Install

```bash
npm install -g @scira/cli
```

Requires **Node.js ≥ 20**. Run the interactive setup:

```bash
scira init
```

This walks you through API keys and configuration with signup links and step-by-step instructions.

Check your setup:

```bash
scira doctor    # verify keys are detected
scira keys      # show where to get any missing keys
```

## Quickstart

```bash
# Interactive TUI (home screen with session history)
scira

# Headless run — writes a report to .scira/runs/<id>/report.md
scira "compare browser automation tools in 2025"

# Interactive TUI for a specific question
scira new "history of the Silk Road" --tui

# Classic readline shell for a specific question
scira new "history of the Silk Road" --shell
```

## API keys

Scira needs credentials for an **LLM provider** (model calls) and a **search provider** (web search). Run `scira init` for a guided setup, or copy `.env.example` and fill in keys manually.

**Where keys are loaded from** (highest priority first):

1. Shell environment (already exported in your terminal)
2. `<project>/.scira/.env` when you run Scira from that project
3. `~/.scira/.env` for global defaults

```bash
# Option A: interactive wizard (saves to ~/.scira/.env)
scira init

# Option B: manual — global keys
mkdir -p ~/.scira && cp .env.example ~/.scira/.env

# Option B: manual — project keys only
mkdir -p .scira && cp .env.example .scira/.env

scira doctor   # confirm keys are detected
scira keys     # signup links + steps for anything still missing
```

### LLM providers (set one in config via `scira init` or `/llm`)

| Key | Provider | Where to get it |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (default) | [vercel.com/docs/ai-gateway](https://vercel.com/docs/ai-gateway) → dashboard → AI Gateway → API Keys |
| `XAI_API_KEY` | xAI (Grok) | [console.x.ai](https://console.x.ai/) → API Keys |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI | [dash.cloudflare.com](https://dash.cloudflare.com/) (account ID) + [API Tokens](https://dash.cloudflare.com/profile/api-tokens) with Workers AI permission |
| `HF_API_KEY` | Hugging Face Inference | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |

### Search providers (set one via `scira init` or `/provider`)

| Key | Provider | Where to get it |
|---|---|---|
| `EXA_API_KEY` | Exa (default) | [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) |
| `FIRECRAWL_API_KEY` | Firecrawl | [firecrawl.dev/app/api-keys](https://www.firecrawl.dev/app/api-keys) |
| `PARALLEL_API_KEY` | Parallel | [platform.parallel.ai](https://platform.parallel.ai/) |

`FIRECRAWL_API_KEY` is also used as an automatic fallback when Exa or Parallel search fails, so it is worth setting even if Firecrawl is not your primary search provider.

## Commands

| Command | Description |
|---|---|
| `scira init` | Interactive setup for API keys and configuration |
| `scira keys` | Show where to get and save missing API keys |
| `scira [question]` | Open TUI home, or run headlessly if a question is given |
| `scira new <question>` | Start a run; add `--tui` or `--shell` to open interactive UI |
| `scira resume <run-id>` | Resume a run; add `--tui` or `--shell` to specify UI |
| `scira list` | List all runs |
| `scira show <run-id>` | Print run status (sources, claims, report state) |
| `scira run <run-id>` | Re-run the research agent on an existing run |
| `scira verify <run-id>` | Print the claim verification report |
| `scira export <run-id>` | Export report (md, json, or csv) with `--format` and `--output` |
| `scira mcp list` | List configured MCP servers |
| `scira mcp add <transport> <name> <target>` | Add an MCP server (stdio, sse, or http) |
| `scira mcp oauth <name>` | Run OAuth PKCE flow for an MCP server |
| `scira mcp enable <name>` | Enable an MCP server |
| `scira mcp disable <name>` | Disable an MCP server |
| `scira mcp remove <name>` | Remove an MCP server from config |
| `scira watch <goal>` | Monitor a topic on a schedule with diffing |
| `scira models [--provider <p>]` | List available AI Gateway models |
| `scira config` | Print the resolved config |
| `scira doctor` | Check credentials and environment |

## Configuration

Config merges `~/.scira/config.json` (global) with `.scira/config.json` (project). All fields are optional.

```json
{
  "model": "deepseek/deepseek-v4-flash",
  "approvalMode": "suggest",
  "runDirectory": ".scira/runs",
  "maxSources": 20,
  "citationPolicy": "strict",
  "search": {
    "provider": "exa",
    "maxResults": 8,
    "includeDomains": [],
    "excludeDomains": []
  }
}
```

| Field | Default | Description |
|---|---|---|
| `model` | `deepseek/deepseek-v4-flash` | AI Gateway model ID |
| `approvalMode` | `suggest` | `manual`, `suggest`, or `auto` tool approval |
| `runDirectory` | `.scira/runs` | Local directory where run data is stored |
| `maxSources` | `20` | Max sources the agent may gather per run |
| `citationPolicy` | `strict` | `strict` (all claims cited) or `balanced` |
| `search.provider` | `exa` | `exa`, `firecrawl`, or `parallel` |
| `search.maxResults` | `8` | Max results per search query |

## Environment variables

See [API keys](#api-keys) for signup links. Required keys depend on your `llmProvider` and `search.provider` in config.

| Variable | Required when | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` | `llmProvider: gateway` | Vercel AI Gateway model calls |
| `XAI_API_KEY` | `llmProvider: xai` or xSearch | Grok model calls; also enables the `xSearch` tool for real-time X/Twitter posts |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | `llmProvider: workers-ai` | Workers AI model calls |
| `HF_API_KEY` | `llmProvider: huggingface` | Hugging Face Inference |
| `EXA_API_KEY` | `search.provider: exa` | Web search via Exa |
| `FIRECRAWL_API_KEY` | `search.provider: firecrawl` | Web search + scrape via Firecrawl |
| `PARALLEL_API_KEY` | `search.provider: parallel` | Web search via Parallel |

## Run Directory

Each run writes to `.scira/runs/<run-id>/`:

```
goal.txt          original question
plan.md           agent's research plan
notes.md          incremental findings
sources.jsonl     sources gathered (id, url, title, snapshot path)
claims.jsonl      claims extracted and verified
report.md         final report
convo.json        full conversation + feed (for TUI resume)
```

## License

MIT
