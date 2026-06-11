import { createMCPClient, type MCPClientConfig } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";
import { SciraConfig } from "../types/index.js";
import { resolveOAuthToken } from "./mcp-oauth.js";

export type McpBridge = {
  tools: ToolSet;
  close: () => Promise<void>;
  toolNames: string[];
};

const NOOP_BRIDGE: McpBridge = {
  tools: {} as ToolSet,
  close: async () => {},
  toolNames: []
};

type ServerEntry = {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  toolPrefix?: string;
  env?: Record<string, string>;
  authType?: "none" | "bearer" | "header" | "oauth";
  bearerToken?: string;
  headerName?: string;
  headerValue?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthIssuerUrl?: string;
  oauthAuthorizationUrl?: string;
  oauthTokenUrl?: string;
  oauthScopes?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  oauthTokenExpiresAt?: number;
};

function resolveMcpHeaders(srv: ServerEntry, oauthToken?: string): Record<string, string> | undefined {
  if (srv.authType === "oauth" && oauthToken) {
    return { Authorization: `Bearer ${oauthToken}` };
  }
  if (srv.authType === "bearer" && srv.bearerToken) {
    return { Authorization: `Bearer ${srv.bearerToken}` };
  }
  if (srv.authType === "header" && srv.headerName && srv.headerValue) {
    return { [srv.headerName]: srv.headerValue };
  }
  return undefined;
}

async function connectServer(srv: ServerEntry, config?: SciraConfig): Promise<McpBridge> {
  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  try {
    let transport: MCPClientConfig["transport"];

    if (srv.transport === "stdio") {
      if (!srv.command) throw new Error(`MCP server "${srv.name}" is missing required "command" for stdio transport.`);
      const cleanEnv = srv.env && Object.keys(srv.env).length > 0
        ? Object.fromEntries(Object.entries({ ...process.env, ...srv.env }).filter((e): e is [string, string] => e[1] !== undefined))
        : undefined;
      transport = new Experimental_StdioMCPTransport({
        command: srv.command,
        args: srv.args ?? [],
        stderr: "pipe",
        ...(cleanEnv ? { env: cleanEnv } : {}),
      });
    } else if (srv.transport === "sse") {
      if (!srv.url) throw new Error(`MCP server "${srv.name}" is missing required "url" for sse transport.`);
      const oauthToken = (srv.authType === "oauth" && config)
        ? await resolveOAuthToken(srv as SciraConfig["mcp"]["servers"][number], config)
        : undefined;
      const headers = resolveMcpHeaders(srv, oauthToken);
      transport = { type: "sse" as const, url: srv.url, ...(headers ? { headers } : {}) };
    } else {
      if (!srv.url) throw new Error(`MCP server "${srv.name}" is missing required "url" for http transport.`);
      const oauthToken = (srv.authType === "oauth" && config)
        ? await resolveOAuthToken(srv as SciraConfig["mcp"]["servers"][number], config)
        : undefined;
      const headers = resolveMcpHeaders(srv, oauthToken);
      transport = { type: "http" as const, url: srv.url, ...(headers ? { headers } : {}) };
    }

    client = await createMCPClient({ transport, clientName: "scira-cli" });
    const raw = await client.tools();
    const prefix = srv.toolPrefix ?? "";
    const prefixed: Record<string, unknown> = {};
    const toolNames: string[] = [];
    for (const [toolName, tool] of Object.entries(raw)) {
      const finalName = prefix ? `${prefix}${toolName}` : toolName;
      prefixed[finalName] = tool;
      toolNames.push(finalName);
    }
    const owned = client;
    return {
      tools: prefixed as ToolSet,
      toolNames,
      close: async () => { try { await owned.close(); } catch { /* ignore */ } }
    };
  } catch (error) {
    if (client) { try { await client.close(); } catch { /* ignore */ } }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n[scira] MCP server "${srv.name}" unavailable: ${message}\n`);
    return NOOP_BRIDGE;
  }
}

/**
 * Connect to all enabled MCP servers in config (chromeDevtools + mcp.servers)
 * and merge their tools into a single bridge.
 */
export async function createMcpBridge(config: SciraConfig): Promise<McpBridge> {
  const tasks: Promise<McpBridge>[] = [];

  const dt = config.mcp.chromeDevtools;
  if (dt.enabled) {
    tasks.push(connectServer({ name: "chromeDevtools", transport: "stdio", command: dt.command, args: dt.args, toolPrefix: dt.toolPrefix }));
  }

  for (const srv of config.mcp.servers) {
    if (srv.enabled) tasks.push(connectServer(srv, config));
  }

  if (tasks.length === 0) return NOOP_BRIDGE;

  const bridges = await Promise.all(tasks);
  const mergedTools: Record<string, unknown> = {};
  const mergedNames: string[] = [];
  const closeFns: Array<() => Promise<void>> = [];
  for (const b of bridges) {
    Object.assign(mergedTools, b.tools);
    mergedNames.push(...b.toolNames);
    closeFns.push(b.close);
  }
  return {
    tools: mergedTools as ToolSet,
    toolNames: mergedNames,
    close: async () => { await Promise.all(closeFns.map((fn) => fn())); }
  };
}
