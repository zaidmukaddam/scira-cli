import process from "node:process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MANAGED_ENV_KEYS = [
  "AI_GATEWAY_API_KEY",
  "XAI_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "HF_API_KEY",
  "PARALLEL_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY"
] as const;

export type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

export function isManagedEnvKey(name: string): name is ManagedEnvKey {
  return (MANAGED_ENV_KEYS as readonly string[]).includes(name);
}

/** Path to the global env file that the CLI loads on startup. */
export const globalEnvPath = join(homedir(), ".scira", ".env");

/** Per-project env file: `<projectRoot>/.scira/.env` (overrides global keys). */
export function projectEnvPath(projectRoot = process.cwd()): string {
  return join(projectRoot, ".scira", ".env");
}

/** Parse simple KEY=VALUE lines from a dotenv file. */
export function parseEnvFile(content: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.replace(/^export\s+/u, "");
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!key) continue;
    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push([key, value]);
  }
  return out;
}

function applyEnvFile(path: string, opts: { skipKeys: ReadonlySet<string>; overrideExisting: boolean }): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const [key, value] of parseEnvFile(content)) {
    if (opts.skipKeys.has(key)) continue;
    if (!opts.overrideExisting && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

/**
 * Load API keys for the current process.
 * Precedence (highest first): shell env, project `.scira/.env`, `~/.scira/.env`.
 */
export function loadSciraEnv(projectRoot = process.cwd()): void {
  const shellKeys = new Set(Object.keys(process.env));
  applyEnvFile(globalEnvPath, { skipKeys: shellKeys, overrideExisting: false });
  applyEnvFile(projectEnvPath(projectRoot), { skipKeys: shellKeys, overrideExisting: true });
}

/**
 * Persist an environment key to ~/.scira/.env and apply it to the current
 * process so it takes effect immediately without a restart.
 */
export async function setEnvKey(name: string, value: string): Promise<void> {
  const path = globalEnvPath;
  await mkdir(join(homedir(), ".scira"), { recursive: true });
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch {
    content = "";
  }
  const lines = content.length ? content.split("\n") : [];
  const matchIndex = lines.findIndex((line) => line.replace(/^export\s+/u, "").startsWith(`${name}=`));
  const entry = `${name}=${value}`;
  if (matchIndex >= 0) {
    lines[matchIndex] = entry;
  } else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(entry);
  }
  await writeFile(path, `${lines.join("\n")}\n`);
  process.env[name] = value;
}
