import { render } from "ink";
import { SciraConfig } from "../../types/index.js";
import { SciraApp } from "../../ui/ink/SciraApp.js";
import { closeAllHarnessSessions } from "../../agent/harness-agent.js";

export async function openTuiHome(config: SciraConfig): Promise<void> {
  const instance = render(<SciraApp config={config} />, { alternateScreen: true, maxFps: 20, exitOnCtrlC: false });
  await instance.waitUntilExit();
  await closeAllHarnessSessions();
}

export async function openTui(runPath: string, config: SciraConfig): Promise<void> {
  const instance = render(<SciraApp runPath={runPath} config={config} />, { alternateScreen: true, maxFps: 20, exitOnCtrlC: false });
  await instance.waitUntilExit();
  await closeAllHarnessSessions();
}
