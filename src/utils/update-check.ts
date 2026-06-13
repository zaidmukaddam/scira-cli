import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PKG = "@scira/cli";
const CACHE_FILE = join(homedir(), ".scira", "update-check.json");
const THROTTLE_MS = 24 * 60 * 60 * 1000; // check npm at most once a day

type Cache = { checkedAt: number; latest: string | null };

/** `true` when `latest` is a higher semver than `current` (pre-release suffixes ignored). */
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG}/latest`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the available update (or null), checking npm at most once per day.
 * Network/parse failures resolve to null and are swallowed — this never throws
 * and never blocks for more than ~3s (and only that once a day).
 */
export async function checkForUpdate(current: string): Promise<{ current: string; latest: string } | null> {
  let cache: Cache | null = null;
  try {
    cache = (await Bun.file(CACHE_FILE).json()) as Cache;
  } catch { /* no/invalid cache */ }

  const now = Date.now();
  let latest = cache?.latest ?? null;

  if (!cache || now - cache.checkedAt > THROTTLE_MS) {
    // Keep the previously-known version on a failed fetch — a transient network
    // error shouldn't discard an update we already knew about (and then suppress
    // it for the rest of the throttle window).
    latest = (await fetchLatest()) ?? latest;
    // Persist (even on failure) so we don't re-check on every command today.
    try {
      await mkdir(join(homedir(), ".scira"), { recursive: true });
      await Bun.write(CACHE_FILE, JSON.stringify({ checkedAt: now, latest } satisfies Cache));
    } catch { /* best-effort */ }
  }

  return latest && isNewer(latest, current) ? { current, latest } : null;
}

/** One-line, human-facing update message. */
export function formatUpdateNotice(u: { current: string; latest: string }): string {
  return `Update available: ${u.current} → ${u.latest} · run "bun add -g ${PKG}"`;
}
