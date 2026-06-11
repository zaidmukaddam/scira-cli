# Scira CLI

Terminal-native AI research and coding agent. Ask a question, get a grounded report with cited sources and verified claims — all stored locally and inspectable.

## Install

```bash
npm install -g @scira/cli
```

Requires **Node.js ≥ 20**. Run the interactive setup:

```bash
scira init
```

This walks you through API keys and configuration. Keys go in `~/.scira/.env` so they work from any directory.

Check your setup:

```bash
scira doctor
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

## Setup

Put your API keys in `~/.scira/.env` (loaded automatically from any working directory):

```bash
mkdir -p ~/.scira && cp .env.example ~/.scira/.env
# then edit ~/.scira/.env
```

## Commands

| Command | Description |
|---|---|
| `scira init` | Interactive setup for API keys and configuration |
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

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Yes | Vercel AI Gateway — all model calls |
| `EXA_API_KEY` | With Exa | Web search via Exa |
| `FIRECRAWL_API_KEY` | With Firecrawl | Web scraping via Firecrawl |

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
