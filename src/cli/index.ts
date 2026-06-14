#!/usr/bin/env bun
import process from "node:process";

if (typeof Bun === "undefined") {
  console.error("scira requires Bun. Install it from https://bun.sh and run: bun run dist/cli/index.js");
  process.exit(1);
}
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sade from "sade";

const { version: pkgVersion } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")
) as { version: string };

import { loadSciraEnv } from "../config/env-store.js";

// Shell env wins, then ~/.scira/.env, then <cwd>/.scira/.env (project overrides global).
loadSciraEnv(process.cwd());

import { loadConfig } from "../config/load-config.js";
import { createRun, findRun, listRuns, summarizeRun, verificationReport, getRunPaths } from "../storage/run-store.js";
import { readJsonl } from "../storage/jsonl.js";
import { type Source, type Claim } from "../types/index.js";
import { runResearchAgent } from "../agent/main-agent.js";
import { openShell } from "./shell/shell.js";
import { openTui, openTuiHome } from "./shell/tui.js";
import { detectEnv } from "../providers/llm/readiness.js";
import { envFileSetupInstructions, formatMissingKeysHelp } from "../config/env-guide.js";
import { requireLlmKeys } from "../providers/llm/registry.js";
import { listModels } from "../providers/llm/models.js";
import { listGatewayModels } from "../providers/llm/gateway.js";
import { createMcpBridge } from "../tools/mcp-bridge.js";
import { saveGlobalMcpConfig } from "../config/load-config.js";
import { runOAuthFlow } from "../tools/mcp-oauth.js";
import { initCommand } from "./commands/init.js";
import { checkForUpdate, formatUpdateNotice } from "../utils/update-check.js";
import { checkRoutineNotices, formatRoutineNotice } from "../utils/routine-notice.js";

// Once per invocation (throttled to a real npm check at most daily): surface an
// available update. The TUI shows it as an in-app notice; CLI commands print it.
// Skip for --version/--help so those stay instant (the daily check can spend up
// to ~3s on the network, and sade prints+exits for these before any command).
const argv = process.argv.slice(2);
const wantsUpdateCheck = !argv.some((a) => ["-v", "--version", "-h", "--help"].includes(a));
const update = wantsUpdateCheck ? await checkForUpdate(pkgVersion) : null;
const updateNotice = update ? formatUpdateNotice(update) : undefined;
const routineResults = wantsUpdateCheck ? await checkRoutineNotices() : [];
const routineNotice = routineResults.length > 0 ? formatRoutineNotice(routineResults) : undefined;
// The TUI renders the notice in-app, so the finally banner would double it up.
let noticeShownInApp = false;

const prog = sade("scira");

prog
  .version(pkgVersion)
  .describe("Terminal-native AI research agent.");

prog
  .command("*", "research question or coding task", { default: true })
  .option("--workspace", "enable coding tools for this workspace directory")
  .action(async (opts: { workspace?: string; _: string[] }) => {
    const question = opts._.length > 0 ? opts._.join(" ") : undefined;
    const config = await loadConfig();
    if (!question) {
      noticeShownInApp = !!updateNotice;
      await openTuiHome(config, updateNotice);
      return;
    }
    requireLlmKeys(config);
    const run = await createRun(question, config);
    console.log(`Run: ${run.path}`);
    if (opts.workspace) console.log(`Workspace: ${opts.workspace}`);
    console.log("");
    await runResearchAgent(run.path, question, config, opts.workspace);
    console.log(`\nRun complete: ${run.path}`);
  });

prog
  .command("init", "initialize Scira with API keys and configuration")
  .action(async () => {
    await initCommand();
  });

prog
  .command("new <question>", "create a new interactive research run")
  .option("--no-shell", "create the run without opening the interactive shell")
  .option("--tui", "open the Ink TUI after creating the run")
  .option("--shell", "open the classic readline shell after creating the run")
  .action(async (question: string, opts: { shell?: boolean; tui?: boolean }) => {
    const config = await loadConfig();
    const run = await createRun(question, config);
    if (opts.tui) {
      noticeShownInApp = !!updateNotice;
      await openTui(run.path, config, updateNotice);
    } else if (opts.shell) {
      await openShell(run.path, config);
    } else {
      console.log(`Created: ${run.path}`);
      console.log(`Open TUI: scira resume --tui ${run.id}`);
    }
  });

prog
  .command("resume <run-id>", "resume an existing run")
  .option("--shell", "resume in the classic readline shell")
  .option("--tui", "resume in the Ink TUI")
  .action(async (runId: string, opts: { shell?: boolean; tui?: boolean }) => {
    const config = await loadConfig();
    const runPath = await findRun(runId, config);
    if (opts.shell) {
      await openShell(runPath, config);
    } else {
      noticeShownInApp = !!updateNotice;
      await openTui(runPath, config, updateNotice);
    }
  });

prog
  .command("list", "list runs")
  .action(async () => {
    const config = await loadConfig();
    console.table(await listRuns(config));
  });

prog
  .command("show <run-id>", "show run status")
  .action(async (runId: string) => {
    const config = await loadConfig();
    console.log(await summarizeRun(await findRun(runId, config)));
  });

prog
  .command("run <run-id>", "run (or re-run) the research agent on an existing run")
  .action(async (runId: string) => {
    const config = await loadConfig();
    requireLlmKeys(config);
    const runPath = await findRun(runId, config);
    const goal = (await summarizeRun(runPath)).goal;
    await runResearchAgent(runPath, goal, config);
    console.log(`\nRun complete: ${runPath}`);
  });

prog
  .command("verify <run-id>", "show the verification report for a run's claims")
  .action(async (runId: string) => {
    const config = await loadConfig();
    const runPath = await findRun(runId, config);
    console.log(await verificationReport(runPath));
  });

prog
  .command("export <run-id>", "export run report (md, json, or csv)")
  .option("--format", "export format: md | json | csv", "md")
  .option("--output", "write to file instead of stdout")
  .action(async (runId: string, opts: { format: string; output?: string }) => {
    const fmt = opts.format.toLowerCase();
    if (!["md", "json", "csv"].includes(fmt)) {
      throw new Error(`Unknown format "${opts.format}". Supported: md, json, csv.`);
    }
    const config = await loadConfig();
    const runPath = await findRun(runId, config);
    let output: string;
    if (fmt === "md") {
      output = await Bun.file(`${runPath}/report.md`).text().catch(() => "");
    } else {
      const { toJson, toCsv } = await import("../export/formatters.js");
      const paths = getRunPaths(runPath);
      const [sources, claims, goal] = await Promise.all([
        readJsonl<Source>(paths.sources),
        readJsonl<Claim>(paths.claims),
        readFile(paths.goal, "utf8").then((t) => t.replace(/^# Goal\s*/u, "").trim()),
      ]);
      const bundle = { runId, goal, sources, claims };
      output = fmt === "json" ? toJson(bundle) : toCsv(bundle);
    }
    if (opts.output) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(opts.output), { recursive: true });
      await Bun.write(opts.output, output);
      console.log(`Exported to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

prog
  .command("mcp list", "list configured MCP servers")
  .action(async () => {
    const config = await loadConfig();
    const dt = config.mcp.chromeDevtools;
    console.log(`chromeDevtools [stdio] ${dt.enabled ? "enabled" : "disabled"}  ${[dt.command, ...dt.args].join(" ")}`);
    for (const s of config.mcp.servers) {
      const loc = s.transport === "stdio" ? [s.command, ...s.args].filter(Boolean).join(" ") : s.url ?? "";
      const authLabel = s.authType && s.authType !== "none" ? ` auth:${s.authType}` : "";
      const oauthStatus = s.authType === "oauth" ? (s.oauthAccessToken ? " [connected]" : " [not connected]") : "";
      console.log(`${s.name} [${s.transport}]${authLabel}${oauthStatus} ${s.enabled ? "enabled" : "disabled"}  ${loc}`);
    }
  });

prog
  .command("mcp add <transport> <name> <target> [args...]", "add an MCP server")
  .option("--bearer", "bearer token for Authorization header")
  .option("--header", "custom header in name:value format")
  .option("--oauth", "use OAuth PKCE flow (requires --oauth-client-id)")
  .option("--oauth-client-id", "OAuth client ID")
  .option("--oauth-client-secret", "OAuth client secret (optional for PKCE)")
  .option("--oauth-issuer", "OAuth issuer URL for auto-discovery")
  .option("--oauth-auth-url", "OAuth authorization endpoint URL")
  .option("--oauth-token-url", "OAuth token endpoint URL")
  .option("--oauth-scopes", "OAuth scopes (space-separated)")
  .action(async (
    transport: string, name: string, target: string, args: string[] | string,
    opts: { bearer?: string; header?: string; oauth?: boolean; oauthClientId?: string; oauthClientSecret?: string; oauthIssuer?: string; oauthAuthUrl?: string; oauthTokenUrl?: string; oauthScopes?: string }
  ) => {
    const restArgs = Array.isArray(args) ? args : args ? [args] : [];
    if (!["stdio", "sse", "http"].includes(transport)) {
      throw new Error("transport must be one of: stdio, sse, http");
    }
    const config = await loadConfig();
    if (config.mcp.servers.some((s) => s.name === name)) {
      throw new Error(`MCP server "${name}" already exists.`);
    }
    let authType: "none" | "bearer" | "header" | "oauth" = "none";
    let bearerToken: string | undefined;
    let headerName: string | undefined;
    let headerValue: string | undefined;
    if (opts.oauth || opts.oauthClientId) {
      authType = "oauth";
    } else if (opts.bearer) {
      authType = "bearer";
      bearerToken = opts.bearer;
    } else if (opts.header) {
      const colonIdx = opts.header.indexOf(":");
      if (colonIdx === -1) throw new Error("--header must be in name:value format");
      authType = "header";
      headerName = opts.header.slice(0, colonIdx).trim();
      headerValue = opts.header.slice(colonIdx + 1).trim();
    }
    const base = {
      name, toolPrefix: "", env: {}, enabled: true, authType,
      bearerToken, headerName, headerValue,
      oauthClientId: opts.oauthClientId,
      oauthClientSecret: opts.oauthClientSecret,
      oauthIssuerUrl: opts.oauthIssuer,
      oauthAuthorizationUrl: opts.oauthAuthUrl,
      oauthTokenUrl: opts.oauthTokenUrl,
      oauthScopes: opts.oauthScopes,
    };
    const entry = transport === "stdio"
      ? { ...base, transport: "stdio" as const, command: target, args: restArgs }
      : { ...base, transport: transport as "sse" | "http", url: target, args: [] };
    const nextMcp = { ...config.mcp, servers: [...config.mcp.servers, entry] };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Added MCP server "${name}" to ~/.scira/config.json (auth: ${authType})`);
    if (authType === "oauth") {
      console.log(`Run: scira mcp oauth ${name}   to authenticate`);
    }
  });

prog
  .command("mcp oauth <name>", "run OAuth PKCE flow for an MCP server")
  .action(async (name: string) => {
    const config = await loadConfig();
    const srv = config.mcp.servers.find((s) => s.name === name);
    if (!srv) throw new Error(`MCP server "${name}" not found. Add it first with: scira mcp add`);
    if (srv.authType !== "oauth") throw new Error(`"${name}" is not an OAuth server (authType: ${srv.authType})`);
    await runOAuthFlow(srv, config);
  });

prog
  .command("mcp enable <name>", "enable an MCP server")
  .action(async (name: string) => {
    const config = await loadConfig();
    const nextMcp = name === "chromeDevtools" || name === "devtools"
      ? { ...config.mcp, chromeDevtools: { ...config.mcp.chromeDevtools, enabled: true } }
      : { ...config.mcp, servers: config.mcp.servers.map((s) => s.name === name ? { ...s, enabled: true } : s) };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Enabled MCP server "${name}"`)
  });

prog
  .command("mcp disable <name>", "disable an MCP server")
  .action(async (name: string) => {
    const config = await loadConfig();
    const nextMcp = name === "chromeDevtools" || name === "devtools"
      ? { ...config.mcp, chromeDevtools: { ...config.mcp.chromeDevtools, enabled: false } }
      : { ...config.mcp, servers: config.mcp.servers.map((s) => s.name === name ? { ...s, enabled: false } : s) };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Disabled MCP server "${name}"`)
  });

prog
  .command("mcp remove <name>", "remove an MCP server from config")
  .action(async (name: string) => {
    const config = await loadConfig();
    if (!config.mcp.servers.some((s) => s.name === name)) {
      throw new Error(`MCP server "${name}" not found.`);
    }
    const nextMcp = { ...config.mcp, servers: config.mcp.servers.filter((s) => s.name !== name) };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Removed MCP server "${name}" from ~/.scira/config.json`);
  });

prog
  .command("routine save <run-id>", "save a completed run as a repeatable scheduled routine")
  .option("--name", "human-readable label for this routine")
  .option("--at", "time of day to run in HH:MM 24h format", "09:00")
  .option("--every", "frequency: day | weekday | week", "day")
  .action(async (runId: string, opts: { name?: string; at: string; every: string }) => {
    const { routineSave } = await import("./commands/routine.js");
    await routineSave(runId, opts);
  });

prog
  .command("routine list", "list all saved routines")
  .action(async () => {
    const { routineList } = await import("./commands/routine.js");
    await routineList();
  });

prog
  .command("routine remove <id>", "remove a routine by id or name")
  .action(async (id: string) => {
    const { routineRemove } = await import("./commands/routine.js");
    await routineRemove(id);
  });

prog
  .command("routine run <id>", "manually trigger a routine now")
  .action(async (id: string) => {
    const { routineRun } = await import("./commands/routine.js");
    await routineRun(id);
  });

prog
  .command("daemon start", "start the background routine scheduler")
  .action(async () => {
    const { daemonStart } = await import("./commands/daemon-cmd.js");
    await daemonStart();
  });

prog
  .command("daemon stop", "stop the background routine scheduler")
  .action(async () => {
    const { daemonStop } = await import("./commands/daemon-cmd.js");
    await daemonStop();
  });

prog
  .command("daemon status", "show routine scheduler status and upcoming schedules")
  .action(async () => {
    const { daemonStatus } = await import("./commands/daemon-cmd.js");
    await daemonStatus();
  });

prog
  .command("watch <goal>", "monitor a topic by running research on a schedule and diffing reports")
  .option("--daily", "run once per day (default)")
  .option("--hourly", "run once per hour")
  .option("--weekly", "run once per week")
  .option("--interval", "custom interval in milliseconds")
  .option("--runs", "stop after N runs (default: run forever)")
  .action(async (goal: string, opts: {
    daily?: boolean; hourly?: boolean; weekly?: boolean;
    interval?: string | number; runs?: string | number;
  }) => {
    const config = await loadConfig();
    const INTERVALS: Record<string, number> = {
      hourly: 60 * 60 * 1000,
      daily:  24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };
    const intervalMs = opts.interval
      ? parseInt(String(opts.interval), 10)
      : opts.hourly  ? INTERVALS.hourly
      : opts.weekly  ? INTERVALS.weekly
      : INTERVALS.daily;
    if (Number.isNaN(intervalMs) || intervalMs < 1000) {
      throw new Error("Interval must be at least 1000 ms.");
    }
    const maxRuns = opts.runs != null ? parseInt(String(opts.runs), 10) : undefined;
    const { watchLoop } = await import("../watch/runner.js");
    const controller = new AbortController();
    process.on("SIGINT",  () => { console.log("\nStopping watch…"); controller.abort(); });
    process.on("SIGTERM", () => { controller.abort(); });
    console.log(`Watching: "${goal}"`);
    console.log(`Interval: ${intervalMs / 1000}s${maxRuns ? ` · max ${maxRuns} runs` : ""}`);
    console.log("Press Ctrl-C to stop.\n");
    await watchLoop({
      goal, intervalMs, maxRuns, config,
      onRunStart:    (runPath, tick) => { console.log(`\n[tick ${tick + 1}] Starting run → ${runPath}`); },
      onRunComplete: (runPath, diffText, tick) => { console.log(`[tick ${tick + 1}] Done. Diff:\n${diffText}`); },
      onError:       (err, tick) => { console.error(`[tick ${tick + 1}] Error: ${err.message}`); },
    }, controller.signal);
    console.log("Watch finished.");
  });

prog
  .command("models", "list models for the configured LLM provider")
  .option("--provider", "gateway only: filter by model prefix such as anthropic, openai, or google")
  .action(async (opts: { provider?: string }) => {
    const config = await loadConfig();
    const models = config.llmProvider === "gateway" && opts.provider
      ? await listGatewayModels(opts.provider)
      : await listModels(config);
    for (const model of models) {
      console.log(model.id);
    }
  });

prog
  .command("config", "print resolved config")
  .action(async () => {
    console.log(JSON.stringify(await loadConfig(), null, 2));
  });

prog
  .command("doctor", "check local setup")
  .action(async () => {
    const config = await loadConfig();
    const nodeCheck = checkNodeVersion(20);
    const nodeStatus = nodeCheck.ok ? "ok" : "fail";
    console.log(`Node:           ${process.version} (${nodeStatus}, requires >=${nodeCheck.required})`);
    const bunVersion = await getBunVersion();
    const bunOk = bunVersion !== null && versionAtLeast(bunVersion, "1.2.0");
    console.log(`Bun:            ${bunVersion ?? "not found"} (${bunOk ? "ok" : "fail"}, requires >=1.2.0)`);
    console.log(`LLM provider:   ${config.llmProvider}`);
    console.log(`Model:          ${config.model}`);
    console.log(`Search provider: ${config.search.provider}`);
    console.log("");
    console.log("Environment:");
    const checks = detectEnv(config.search.provider, config.llmProvider);
    for (const check of checks) {
      const status = check.present ? "set    " : "missing";
      const tag = check.required ? " (required)" : "";
      console.log(`  ${status} ${check.name}${tag}  - ${check.purpose}`);
    }

    console.log("");
    console.log("Local agent runtimes (claude-code / codex providers):");
    // Claude Code's token lives in the Keychain on macOS, but the logged-in
    // account metadata is mirrored in ~/.claude.json (oauthAccount), so that's a
    // reliable, cross-platform login check. Codex stores a readable auth file.
    const claudeOnPath = await commandResolves("claude");
    const claudeAccount = readClaudeAccount();
    const claudeStatus = !claudeOnPath ? "missing" : claudeAccount ? "ok     " : "no auth";
    const claudeWho = claudeAccount ? ` (logged in as ${claudeAccount})` : "";
    console.log(`  ${claudeStatus} claude-code  - "claude" ${claudeOnPath ? "on PATH" : "not on PATH (install Claude Code)"}, login ${claudeAccount ? "found" : "not found"}${claudeWho}`);
    if (claudeOnPath && !claudeAccount) console.log(`           Tip: run "claude" and use /login (or "claude doctor" to check) — no API key needed.`);

    const codexOnPath = await commandResolves("codex");
    const codexLoggedIn = existsSync(join(homedir(), ".codex", "auth.json"));
    const codexStatus = !codexOnPath ? "missing" : codexLoggedIn ? "ok     " : "no auth";
    console.log(`  ${codexStatus} codex  - "codex" ${codexOnPath ? "on PATH" : "not on PATH (install Codex)"}, login ${codexLoggedIn ? "found" : "not found"}`);
    if (codexOnPath && !codexLoggedIn) console.log(`           Tip: run "codex login" to authenticate without an API key.`);

    console.log("");
    console.log("MCP servers:");
    const dt = config.mcp.chromeDevtools;
    const userServers = config.mcp.servers;
    const anyEnabled = dt.enabled || userServers.some((s) => s.enabled);
    if (!anyEnabled) {
      console.log("  none enabled");
      console.log("  Tip: add entries to mcp.servers in config, or set mcp.chromeDevtools.enabled=true");
    } else {
      if (dt.enabled) {
        console.log(`  chromeDevtools  [stdio]  ${[dt.command, ...dt.args].join(" ")}`);
        const ok = await commandResolves(dt.command);
        console.log(`    ${ok ? "ok     " : "missing"} executable "${dt.command}" on PATH`);
      }
      for (const srv of userServers) {
        const tag = srv.enabled ? "" : "  (disabled)";
        if (srv.transport === "stdio") {
          console.log(`  ${srv.name}  [stdio]${tag}  ${[srv.command, ...(srv.args ?? [])].join(" ")}`);
          if (srv.command) {
            const ok = await commandResolves(srv.command);
            console.log(`    ${ok ? "ok     " : "missing"} executable "${srv.command}" on PATH`);
          }
        } else {
          console.log(`  ${srv.name}  [${srv.transport}]${tag}  ${srv.url ?? "(no url)"}`);
        }
      }
      console.log("  …  attempting live connection");
      const started = Date.now();
      const bridge = await createMcpBridge(config);
      const elapsedMs = Date.now() - started;
      try {
        if (bridge.toolNames.length === 0) {
          console.log(`  fail     no MCP tools loaded after ${elapsedMs}ms (see stderr above)`);
        } else {
          console.log(`  ok       connected in ${elapsedMs}ms, ${bridge.toolNames.length} tool(s):`);
          for (const name of bridge.toolNames) console.log(`             - ${name}`);
        }
      } finally {
        await bridge.close();
      }
    }

    const missingRequired = checks.filter((c) => c.required && !c.present);
    const blockers: string[] = [];
    if (!nodeCheck.ok) blockers.push(`upgrade Node to >=${nodeCheck.required}`);
    if (!bunOk) blockers.push(bunVersion ? "upgrade Bun to >=1.2.0" : "install Bun (https://bun.sh) — Scira runs on the Bun runtime");
    if (missingRequired.length > 0) {
      blockers.push(`set ${missingRequired.map((c) => c.name).join(", ")} in ~/.scira/.env or .scira/.env in your project`);
    }
    console.log("");
    if (blockers.length > 0) {
      console.log(`Action needed: ${blockers.join("; ")} to enable research runs.`);
      console.log("");
      const help = formatMissingKeysHelp(checks);
      if (help) console.log(help);
    } else {
      console.log("All required credentials present. Ready to run.");
    }
  });

prog
  .command("keys", "show how to get and set API keys")
  .action(async () => {
    const config = await loadConfig();
    const checks = detectEnv(config.search.provider, config.llmProvider);
    console.log(`LLM provider: ${config.llmProvider}`);
    console.log(`Search provider: ${config.search.provider}`);
    console.log("");
    const help = formatMissingKeysHelp(checks);
    if (help) {
      console.log(help);
    } else {
      console.log("All required keys for your current config are set.");
      console.log("");
      console.log(envFileSetupInstructions());
    }
  });

function checkNodeVersion(required: number): { ok: boolean; required: number; current: number } {
  const m = /^v(\d+)/u.exec(process.version);
  const current = m ? Number(m[1]) : 0;
  return { ok: current >= required, required, current };
}

/** The logged-in Claude Code account email from ~/.claude.json, or null if not logged in. */
function readClaudeAccount(): string | null {
  try {
    const raw = readFileSync(join(homedir(), ".claude.json"), "utf8");
    const account = (JSON.parse(raw) as { oauthAccount?: { emailAddress?: string } }).oauthAccount;
    return account?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** The running Bun version (e.g. "1.3.14"), or null if not running under Bun. */
function getBunVersion(): string | null {
  return typeof Bun !== "undefined" ? Bun.version : null;
}

/** True when `version` (semver) is >= `min` (semver). */
function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = min.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function commandResolves(command: string): boolean {
  return Bun.which(command) !== null;
}

try {
  const parsed = prog.parse(process.argv, { lazy: true });
  if (parsed?.handler) {
    await parsed.handler(...parsed.args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // Reminder after a CLI command finishes. Skipped when the TUI already
  // rendered the notice in-app, so we don't show it twice.
  if (updateNotice && !noticeShownInApp) process.stderr.write(`\n\x1b[2m${updateNotice}\x1b[0m\n`);
  if (routineNotice) process.stderr.write(`\n\x1b[36m${routineNotice}\x1b[0m\n`);
}
