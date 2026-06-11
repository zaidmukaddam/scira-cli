import process from "node:process";
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
