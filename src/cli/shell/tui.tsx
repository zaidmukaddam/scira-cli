import { render } from "ink";
import { SciraConfig } from "../../types/index.js";
import { SciraApp } from "../../ui/ink/SciraApp.js";

export async function openTuiHome(config: SciraConfig): Promise<void> {
  const instance = render(<SciraApp config={config} />, { alternateScreen: true, maxFps: 20 });
  await instance.waitUntilExit();
}

export async function openTui(runPath: string, config: SciraConfig): Promise<void> {
  const instance = render(<SciraApp runPath={runPath} config={config} />, { alternateScreen: true, maxFps: 20 });
  await instance.waitUntilExit();
}
