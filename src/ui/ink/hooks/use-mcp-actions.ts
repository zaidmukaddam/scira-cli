import { useCallback } from "react";
import { saveGlobalMcpConfig } from "../../../config/load-config.js";
import { type SciraConfig } from "../../../types/index.js";

export type McpToggleTarget = { kind: "devtools" } | { kind: "server"; name: string };

export function useMcpActions(
  config: SciraConfig,
  setConfig: (next: SciraConfig) => void,
  notify: (message: string) => void,
): {
  toggleMcp: (target: McpToggleTarget) => Promise<void>;
  removeMcp: (name: string) => Promise<void>;
} {
  const toggleMcp = useCallback(async (target: McpToggleTarget) => {
    if (target.kind === "devtools") {
      const dt = config.mcp.chromeDevtools;
      const enabled = !dt.enabled;
      const next: SciraConfig = {
        ...config,
        mcp: { ...config.mcp, chromeDevtools: { ...dt, enabled } },
      };
      setConfig(next);
      await saveGlobalMcpConfig(next.mcp);
      notify(`chromeDevtools ${enabled ? "enabled" : "disabled"}.`);
      return;
    }
    const idx = config.mcp.servers.findIndex((s) => s.name === target.name);
    if (idx === -1) return;
    const enabled = !config.mcp.servers[idx].enabled;
    const next: SciraConfig = {
      ...config,
      mcp: {
        ...config.mcp,
        servers: config.mcp.servers.map((s, i) => (i === idx ? { ...s, enabled } : s)),
      },
    };
    setConfig(next);
    await saveGlobalMcpConfig(next.mcp);
    notify(`"${target.name}" ${enabled ? "enabled" : "disabled"}.`);
  }, [config, notify, setConfig]);

  const removeMcp = useCallback(async (name: string) => {
    if (!config.mcp.servers.some((s) => s.name === name)) return;
    const next: SciraConfig = {
      ...config,
      mcp: { ...config.mcp, servers: config.mcp.servers.filter((s) => s.name !== name) },
    };
    setConfig(next);
    await saveGlobalMcpConfig(next.mcp);
    notify(`Removed MCP server "${name}".`);
  }, [config, notify, setConfig]);

  return { toggleMcp, removeMcp };
}
