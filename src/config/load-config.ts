import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SciraConfig, SciraConfigSchema } from "../types/index.js";

export const globalConfigPath = join(homedir(), ".scira", "config.json");

export async function loadConfig(projectRoot = process.cwd()): Promise<SciraConfig> {
  const projectConfigPath = join(projectRoot, ".scira", "config.json");
  const globalConfig = await readConfigFile(globalConfigPath);
  const projectConfig = await readConfigFile(projectConfigPath);
  const merged = { ...globalConfig, ...projectConfig };
  // Deep-merge nested objects so project keys win without clobbering sibling keys.
  for (const key of ["mcp", "search", "lastModels"] as const) {
    if (globalConfig[key] && projectConfig[key] && typeof globalConfig[key] === "object" && typeof projectConfig[key] === "object") {
      merged[key] = { ...(globalConfig[key] as object), ...(projectConfig[key] as object) };
    }
  }
  // Prefer global config for llmProvider and model to persist user selections across projects
  if (globalConfig.llmProvider && !projectConfig.llmProvider) {
    merged.llmProvider = globalConfig.llmProvider;
  }
  if (globalConfig.model && !projectConfig.model) {
    merged.model = globalConfig.model;
  }
  return SciraConfigSchema.parse(merged);
}

export async function saveGlobalConfig(config: SciraConfig): Promise<void> {
  await mkdir(dirname(globalConfigPath), { recursive: true });
  await writeFile(globalConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function saveGlobalMcpConfig(config: SciraConfig["mcp"]): Promise<void> {
  const globalConfig = await readConfigFile(globalConfigPath);
  const next = { ...globalConfig, mcp: config };
  await mkdir(dirname(globalConfigPath), { recursive: true });
  await writeFile(globalConfigPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function saveProjectConfig(config: SciraConfig, projectRoot = process.cwd()): Promise<void> {
  const projectConfigPath = join(projectRoot, ".scira", "config.json");
  await mkdir(dirname(projectConfigPath), { recursive: true });
  await writeFile(projectConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function saveProjectMcpConfig(config: SciraConfig["mcp"], projectRoot = process.cwd()): Promise<void> {
  const projectConfigPath = join(projectRoot, ".scira", "config.json");
  const projectConfig = await readConfigFile(projectConfigPath);
  const next = { ...projectConfig, mcp: config };
  await mkdir(dirname(projectConfigPath), { recursive: true });
  await writeFile(projectConfigPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
