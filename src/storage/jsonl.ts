import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonl(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { flag: "a" });
}

export async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const text = await readFile(path, "utf8");
    const results: T[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // skip malformed/truncated lines (e.g. agent wrote unescaped newlines in a value)
      }
    }
    return results;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
