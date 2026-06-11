export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "research";
}

export function createRunId(goal: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const time = date.toISOString().slice(11, 19).replace(/:/g, "");
  return `${stamp}-${time}-${slugify(goal)}`;
}

export function createEntityId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(3, "0")}`;
}
