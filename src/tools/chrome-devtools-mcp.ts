import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";
import { SciraConfig } from "../types/index.js";

export type DevtoolsMcpBridge = {
  tools: ToolSet;
  close: () => Promise<void>;
  toolNames: string[];
};

const NOOP_BRIDGE: DevtoolsMcpBridge = {
  tools: {} as ToolSet,
  close: async () => {},
  toolNames: []
};

/**
 * Spin up the Chrome DevTools MCP server over stdio and return its tools as
 * an AI SDK ToolSet, prefixed to avoid collisions with Scira's built-in tools.
 *
 * If the bridge is disabled in config, or if the MCP server fails to start,
 * this returns a no-op bridge so the agent can still run with built-in tools.
 */
export async function createChromeDevtoolsMcpBridge(config: SciraConfig): Promise<DevtoolsMcpBridge> {
  const cfg = config.mcp.chromeDevtools;
  if (!cfg.enabled) return NOOP_BRIDGE;

  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  try {
    client = await createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: cfg.command,
        args: cfg.args,
        stderr: "pipe"
      }),
      clientName: "scira-cli"
    });
    const raw = await client.tools();
    const prefix = cfg.toolPrefix ?? "";
    const prefixed: Record<string, unknown> = {};
    const toolNames: string[] = [];
    for (const [name, tool] of Object.entries(raw)) {
      const finalName = prefix ? `${prefix}${name}` : name;
      prefixed[finalName] = tool;
      toolNames.push(finalName);
    }
    const owned = client;
    return {
      tools: prefixed as ToolSet,
      close: async () => {
        try { await owned.close(); } catch { /* ignore */ }
      },
      toolNames
    };
  } catch (error) {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n[scira] Chrome DevTools MCP unavailable, continuing without it: ${message}\n`);
    return NOOP_BRIDGE;
  }
}
