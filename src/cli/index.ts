#!/usr/bin/env node
import process from "node:process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

const { version: pkgVersion } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")
) as { version: string };

// Load keys from the global config dir (~/.scira/.env) so they work regardless
// of where the CLI is invoked from (e.g. after pnpm link / global install).
try {
  process.loadEnvFile(join(homedir(), ".scira", ".env"));
} catch {
  // no ~/.scira/.env present; rely on the ambient environment
}

import { loadConfig } from "../config/load-config.js";
import { createRun, findRun, listRuns, summarizeRun, verificationReport, getRunPaths } from "../storage/run-store.js";
import { readJsonl } from "../storage/jsonl.js";
import { type Source, type Claim } from "../types/index.js";
import { runResearchAgent } from "../agent/research-agent.js";
import { openShell } from "./shell/shell.js";
import { openTui, openTuiHome } from "./shell/tui.js";
import { detectEnv } from "../providers/llm/readiness.js";
import { requireLlmKeys } from "../providers/llm/registry.js";
import { listModels } from "../providers/llm/models.js";
import { listGatewayModels } from "../providers/llm/gateway.js";
import { createMcpBridge } from "../tools/mcp-bridge.js";
import { saveGlobalMcpConfig } from "../config/load-config.js";
import { runOAuthFlow } from "../tools/mcp-oauth.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("scira")
  .description("Terminal-native AI research agent.")
  .version(pkgVersion);

program
  .argument("[question]", "research question or coding task")
  .option("--workspace <path>", "enable coding tools for this workspace directory")
  .action(async (question?: string, options?: { workspace?: string }) => {
    const config = await loadConfig();
    if (!question) {
      await openTuiHome(config);
      return;
    }
    requireLlmKeys(config);
    const run = await createRun(question, config);
    console.log(`Run: ${run.path}`);
    if (options?.workspace) {
      console.log(`Workspace: ${options.workspace}`);
    }
    console.log("");
    await runResearchAgent(run.path, question, config, options?.workspace);
    console.log(`\nRun complete: ${run.path}`);
  });

program.command("init")
  .description("initialize Scira with API keys and configuration")
  .action(async () => {
    await initCommand();
  });

program.command("new")
  .argument("<question>")
  .description("create a new interactive research run")
  .option("--no-shell", "create the run without opening the interactive shell")
  .option("--tui", "open the Ink TUI after creating the run")
  .option("--shell", "open the classic readline shell after creating the run")
  .action(async (question: string, options: { shell?: boolean; tui?: boolean }) => {
    const config = await loadConfig();
    const run = await createRun(question, config);
    if (options.tui) {
      await openTui(run.path, config);
    } else if (options.shell) {
      await openShell(run.path, config);
    } else {
      console.log(`Created: ${run.path}`);
      console.log(`Open TUI: scira resume --tui ${run.id}`);
    }
  });

program.command("resume")
  .argument("<run-id>")
  .description("resume an existing run")
  .option("--shell", "resume in the classic readline shell")
  .option("--tui", "resume in the Ink TUI")
  .action(async (runId: string, options: { shell?: boolean; tui?: boolean }) => {
    const config = await loadConfig();
    const runPath = await findRun(runId, config);
    if (options.shell) {
      await openShell(runPath, config);
    } else {
      await openTui(runPath, config);
    }
  });

program.command("list")
  .description("list runs")
  .action(async () => {
    const config = await loadConfig();
    console.table(await listRuns(config));
  });

program.command("show")
  .argument("<run-id>")
  .description("show run status")
  .action(async (runId: string) => {
    const config = await loadConfig();
    console.log(await summarizeRun(await findRun(runId, config)));
  });

program.command("run")
  .argument("<run-id>")
  .description("run (or re-run) the research agent on an existing run")
  .action(async (runId: string) => {
    const config = await loadConfig();
    requireLlmKeys(config);
    const runPath = await findRun(runId, config);
    const goal = (await summarizeRun(runPath)).goal;
    await runResearchAgent(runPath, goal, config);
    console.log(`\nRun complete: ${runPath}`);
  });

program.command("verify")
  .argument("<run-id>")
  .description("show the verification report for a run's claims")
  .action(async (runId: string) => {
    const config = await loadConfig();
    const runPath = await findRun(runId, config);
    console.log(await verificationReport(runPath));
  });

program.command("export")
  .argument("<run-id>")
  .option("--format <format>", "export format: md | json | csv", "md")
  .option("--output <file>", "write to file instead of stdout")
  .description("export run report (md, json, or csv)")
  .action(async (runId: string, options: { format: string; output?: string }) => {
    const fmt = options.format.toLowerCase();
    if (!["md", "json", "csv"].includes(fmt)) {
      throw new Error(`Unknown format "${options.format}". Supported: md, json, csv.`);
    }
    const config = await loadConfig();
    const runPath = await findRun(runId, config);
    let output: string;
    if (fmt === "md") {
      output = await readFile(`${runPath}/report.md`, "utf8");
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
    if (options.output) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, output, "utf8");
      console.log(`Exported to ${options.output}`);
    } else {
      console.log(output);
    }
  });

const mcp = program.command("mcp").description("manage MCP servers in .scira/config.json");

mcp.command("list")
  .description("list configured MCP servers")
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

mcp.command("add")
  .argument("<transport>", "stdio | sse | http")
  .argument("<name>")
  .argument("<target>")
  .argument("[args...]")
  .option("--bearer <token>", "bearer token for Authorization header")
  .option("--header <name:value>", "custom header in name:value format")
  .option("--oauth", "use OAuth PKCE flow (requires --oauth-client-id)")
  .option("--oauth-client-id <id>", "OAuth client ID")
  .option("--oauth-client-secret <secret>", "OAuth client secret (optional for PKCE)")
  .option("--oauth-issuer <url>", "OAuth issuer URL for auto-discovery")
  .option("--oauth-auth-url <url>", "OAuth authorization endpoint URL")
  .option("--oauth-token-url <url>", "OAuth token endpoint URL")
  .option("--oauth-scopes <scopes>", "OAuth scopes (space-separated)")
  .description("add an MCP server")
  .action(async (
    transport: string, name: string, target: string, args: string[],
    opts: { bearer?: string; header?: string; oauth?: boolean; oauthClientId?: string; oauthClientSecret?: string; oauthIssuer?: string; oauthAuthUrl?: string; oauthTokenUrl?: string; oauthScopes?: string }
  ) => {
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
      ? { ...base, transport: "stdio" as const, command: target, args }
      : { ...base, transport: transport as "sse" | "http", url: target, args: [] };
    const nextMcp = { ...config.mcp, servers: [...config.mcp.servers, entry] };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Added MCP server "${name}" to ~/.scira/config.json (auth: ${authType})`);
    if (authType === "oauth") {
      console.log(`Run: scira mcp oauth ${name}   to authenticate`);
    }
  });

mcp.command("oauth")
  .argument("<name>", "name of the OAuth MCP server to authenticate")
  .description("run OAuth PKCE flow for an MCP server")
  .action(async (name: string) => {
    const config = await loadConfig();
    const srv = config.mcp.servers.find((s) => s.name === name);
    if (!srv) throw new Error(`MCP server "${name}" not found. Add it first with: scira mcp add`);
    if (srv.authType !== "oauth") throw new Error(`"${name}" is not an OAuth server (authType: ${srv.authType})`);
    await runOAuthFlow(srv, config);
  });

mcp.command("enable")
  .argument("<name>")
  .description("enable an MCP server")
  .action(async (name: string) => {
    const config = await loadConfig();
    const nextMcp = name === "chromeDevtools" || name === "devtools"
      ? { ...config.mcp, chromeDevtools: { ...config.mcp.chromeDevtools, enabled: true } }
      : { ...config.mcp, servers: config.mcp.servers.map((s) => s.name === name ? { ...s, enabled: true } : s) };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Enabled MCP server "${name}"`)
  });

mcp.command("disable")
  .argument("<name>")
  .description("disable an MCP server")
  .action(async (name: string) => {
    const config = await loadConfig();
    const nextMcp = name === "chromeDevtools" || name === "devtools"
      ? { ...config.mcp, chromeDevtools: { ...config.mcp.chromeDevtools, enabled: false } }
      : { ...config.mcp, servers: config.mcp.servers.map((s) => s.name === name ? { ...s, enabled: false } : s) };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Disabled MCP server "${name}"`)
  });

mcp.command("remove")
  .argument("<name>")
  .description("remove an MCP server from config")
  .action(async (name: string) => {
    const config = await loadConfig();
    if (!config.mcp.servers.some((s) => s.name === name)) {
      throw new Error(`MCP server "${name}" not found.`);
    }
    const nextMcp = { ...config.mcp, servers: config.mcp.servers.filter((s) => s.name !== name) };
    await saveGlobalMcpConfig(nextMcp);
    console.log(`Removed MCP server "${name}" from ~/.scira/config.json`);
  });

program.command("watch")
  .argument("<goal>", "research goal to monitor, e.g. \"AI search market\"")
  .option("--daily",   "run once per day (default)")
  .option("--hourly",  "run once per hour")
  .option("--weekly",  "run once per week")
  .option("--interval <ms>", "custom interval in milliseconds")
  .option("--runs <n>", "stop after N runs (default: run forever)", (v) => parseInt(v, 10))
  .description("monitor a topic by running research on a schedule and diffing reports")
  .action(async (goal: string, options: {
    daily?: boolean; hourly?: boolean; weekly?: boolean;
    interval?: string; runs?: number;
  }) => {
    const config = await loadConfig();
    const INTERVALS: Record<string, number> = {
      hourly: 60 * 60 * 1000,
      daily:  24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };
    const intervalMs = options.interval
      ? parseInt(options.interval, 10)
      : options.hourly  ? INTERVALS.hourly
      : options.weekly  ? INTERVALS.weekly
      : INTERVALS.daily;
    if (Number.isNaN(intervalMs) || intervalMs < 1000) {
      throw new Error("Interval must be at least 1000 ms.");
    }
    const { watchLoop } = await import("../watch/runner.js");
    const controller = new AbortController();
    process.on("SIGINT",  () => { console.log("\nStopping watch…"); controller.abort(); });
    process.on("SIGTERM", () => { controller.abort(); });
    console.log(`Watching: "${goal}"`);
    console.log(`Interval: ${intervalMs / 1000}s${options.runs ? ` · max ${options.runs} runs` : ""}`);
    console.log("Press Ctrl-C to stop.\n");
    await watchLoop({
      goal, intervalMs, maxRuns: options.runs, config,
      onRunStart:    (runPath, tick) => { console.log(`\n[tick ${tick + 1}] Starting run → ${runPath}`); },
      onRunComplete: (runPath, diffText, tick) => { console.log(`[tick ${tick + 1}] Done. Diff:\n${diffText}`); },
      onError:       (err, tick) => { console.error(`[tick ${tick + 1}] Error: ${err.message}`); },
    }, controller.signal);
    console.log("Watch finished.");
  });

program.command("models")
  .option("--provider <provider>", "gateway only: filter by model prefix such as anthropic, openai, or google")
  .description("list models for the configured LLM provider")
  .action(async (options: { provider?: string }) => {
    const config = await loadConfig();
    const models = config.llmProvider === "gateway" && options.provider
      ? await listGatewayModels(options.provider)
      : await listModels(config);
    for (const model of models) {
      console.log(model.id);
    }
  });

program.command("config")
  .description("print resolved config")
  .action(async () => {
    console.log(JSON.stringify(await loadConfig(), null, 2));
  });

program.command("doctor")
  .description("check local setup")
  .action(async () => {
    const config = await loadConfig();
    const nodeCheck = checkNodeVersion(20);
    const nodeStatus = nodeCheck.ok ? "ok" : "fail";
    console.log(`Node:           ${process.version} (${nodeStatus}, requires >=${nodeCheck.required})`);
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
    if (missingRequired.length > 0) blockers.push(`set ${missingRequired.map((c) => c.name).join(", ")} in ~/.scira/.env`);
    console.log("");
    if (blockers.length > 0) {
      console.log(`Action needed: ${blockers.join("; ")} to enable research runs.`);
      console.log(`  Tip: cp .env.example ~/.scira/.env  then fill in your keys.`);
    } else {
      console.log("All required credentials present. Ready to run.");
    }
  });

function checkNodeVersion(required: number): { ok: boolean; required: number; current: number } {
  const m = /^v(\d+)/u.exec(process.version);
  const current = m ? Number(m[1]) : 0;
  return { ok: current >= required, required, current };
}

async function commandResolves(command: string): Promise<boolean> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const which = process.platform === "win32" ? "where" : "command -v";
  try {
    await promisify(exec)(`${which} ${command}`);
    return true;
  } catch {
    return false;
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
