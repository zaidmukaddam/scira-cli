import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type BackgroundTaskStatus = "running" | "exited" | "killed";

export type BackgroundTaskRecord = {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  startedAt: string;
  status: BackgroundTaskStatus;
  exitCode: number | null;
  outputTail: string;
  sessionToken?: string;
};

type RuntimeTask = {
  record: BackgroundTaskRecord;
  proc: ChildProcess;
  output: string[];
  killedByUser?: boolean;
};

const MAX_OUTPUT_LINES = 500;
const MAX_TAIL_CHARS = 4000;

function nextTaskId(existing: BackgroundTaskRecord[]): string {
  const nums = existing
    .map((t) => /^task_(\d+)$/u.exec(t.id)?.[1])
    .filter((n): n is string => Boolean(n))
    .map((n) => Number.parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `task_${String(next).padStart(3, "0")}`;
}

function tailText(lines: string[], maxChars = MAX_TAIL_CHARS): string {
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  return `…[truncated]\n${joined.slice(-maxChars)}`;
}

/** Returns true if a process with this pid is still running. */
function isProcessRunning(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isValidRecord(t: unknown): t is BackgroundTaskRecord {
  if (typeof t !== "object" || t === null) return false;
  const r = t as BackgroundTaskRecord;
  return typeof r.id === "string"
    && typeof r.command === "string"
    && typeof r.cwd === "string"
    && typeof r.pid === "number"
    && typeof r.startedAt === "string"
    && typeof r.status === "string"
    && (r.status === "running" || r.status === "exited" || r.status === "killed");
}

export class BackgroundTaskManager {
  private runtime = new Map<string, RuntimeTask>();
  private records: BackgroundTaskRecord[] = [];
  private loaded = false;
  private readonly sessionToken = randomUUID();

  constructor(
    private readonly persistPath: string,
    private readonly defaultCwd: string
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.persistPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.records = parsed.filter(isValidRecord);
      }
    } catch {
      this.records = [];
    }
    this.reconcileStaleTasks();
  }

  /** Mark persisted "running" tasks as exited when no live process tracks them. */
  private reconcileStaleTasks(): void {
    let changed = false;
    for (const rec of this.records) {
      if (rec.status !== "running") continue;
      if (this.runtime.has(rec.id)) continue;
      if (rec.sessionToken && rec.sessionToken !== this.sessionToken) {
        rec.status = "exited";
        rec.exitCode ??= null;
        changed = true;
        continue;
      }
      if (rec.pid > 0 && isProcessRunning(rec.pid)) continue;
      rec.status = "exited";
      rec.exitCode ??= null;
      changed = true;
    }
    if (changed) void this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(this.records, null, 2) + "\n");
  }

  private syncRecord(task: RuntimeTask): void {
    const idx = this.records.findIndex((r) => r.id === task.record.id);
    task.record.outputTail = tailText(task.output);
    if (idx === -1) this.records.push({ ...task.record });
    else this.records[idx] = { ...task.record };
  }

  async getTask(taskId: string): Promise<BackgroundTaskRecord | undefined> {
    await this.ensureLoaded();
    this.reconcileStaleTasks();
    const live = this.runtime.get(taskId);
    if (live) return { ...live.record };
    return this.records.find((r) => r.id === taskId);
  }

  async spawn(command: string, cwd?: string): Promise<BackgroundTaskRecord> {
    await this.ensureLoaded();
    const id = nextTaskId(this.records);
    const workDir = cwd ?? this.defaultCwd;
    const proc = spawn(command, {
      cwd: workDir,
      shell: "/bin/bash",
      env: process.env,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const record: BackgroundTaskRecord = {
      id,
      command,
      cwd: workDir,
      pid: proc.pid ?? 0,
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      outputTail: "",
      sessionToken: this.sessionToken
    };

    const output: string[] = [];
    let partial = "";
    const append = (chunk: Buffer) => {
      const text = partial + chunk.toString();
      const lines = text.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) output.push(line);
      }
      while (output.length > MAX_OUTPUT_LINES) output.shift();
      const rt = this.runtime.get(id);
      if (rt) {
        rt.output = output;
        rt.record.outputTail = tailText(output);
      }
    };
    const flushPartial = () => {
      if (partial.length > 0) {
        output.push(partial);
        partial = "";
        while (output.length > MAX_OUTPUT_LINES) output.shift();
      }
    };

    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);

    const runtime: RuntimeTask = { record, proc, output };
    this.runtime.set(id, runtime);
    this.records.push({ ...record });
    await this.persist();

    proc.on("close", (code) => {
      flushPartial();
      if (runtime.killedByUser) {
        record.status = "killed";
        record.exitCode = record.exitCode ?? 143;
      } else {
        record.status = "exited";
        record.exitCode = code;
      }
      record.outputTail = tailText(output);
      this.syncRecord(runtime);
      void this.persist();
      this.runtime.delete(id);
    });

    proc.on("error", (err) => {
      flushPartial();
      output.push(`[spawn error] ${err.message}`);
      record.status = "exited";
      record.exitCode = 1;
      record.outputTail = tailText(output);
      this.syncRecord(runtime);
      void this.persist();
      this.runtime.delete(id);
    });

    return { ...record };
  }

  async list(): Promise<BackgroundTaskRecord[]> {
    await this.ensureLoaded();
    this.reconcileStaleTasks();
    for (const rt of this.runtime.values()) {
      rt.record.outputTail = tailText(rt.output);
      this.syncRecord(rt);
    }
    return this.records.map((r) => {
      const live = this.runtime.get(r.id);
      return live ? { ...live.record } : { ...r };
    });
  }

  async getOutput(taskId: string, tailLines = 50): Promise<string> {
    await this.ensureLoaded();
    this.reconcileStaleTasks();
    const live = this.runtime.get(taskId);
    if (live) {
      const lines = live.output.slice(-tailLines);
      return lines.length > 0 ? lines.join("\n") : "(no output yet)";
    }
    const rec = this.records.find((r) => r.id === taskId);
    if (!rec) return `Task "${taskId}" not found.`;
    const lines = rec.outputTail.split("\n").slice(-tailLines);
    return lines.length > 0 ? lines.join("\n") : "(no output)";
  }

  async kill(taskId: string): Promise<string> {
    await this.ensureLoaded();
    this.reconcileStaleTasks();
    const live = this.runtime.get(taskId);
    if (live) {
      live.killedByUser = true;
      live.proc.kill("SIGTERM");
      live.record.status = "killed";
      live.record.exitCode = live.record.exitCode ?? 143;
      this.syncRecord(live);
      await this.persist();
      return `Killed ${taskId} (pid ${live.record.pid}).`;
    }
    const rec = this.records.find((r) => r.id === taskId);
    if (!rec) return `Task "${taskId}" not found.`;
    if (rec.status !== "running") return `${taskId} is already ${rec.status}.`;
    if (rec.sessionToken !== this.sessionToken) {
      rec.status = "exited";
      await this.persist();
      return `Task ${taskId} was started in a previous session and cannot be killed from here. Marked as exited.`;
    }
    rec.status = "exited";
    rec.exitCode ??= null;
    await this.persist();
    return `Task ${taskId} is not running in this session.`;
  }

  async formatContextForAgent(): Promise<string> {
    const tasks = await this.list();
    const active = tasks.filter((t) => t.status === "running");
    if (active.length === 0) return "";
    const lines = active.map(
      (t) => `  - ${t.id}: [running pid ${t.pid}] ${t.command} (cwd: ${t.cwd})`
    );
    return `\nActive background tasks:\n${lines.join("\n")}\nUse bash with action "output" and taskId to read logs, or action "kill" to stop a task.\n`;
  }
}

export function createBackgroundTaskManager(runPath: string, workspacePath: string): BackgroundTaskManager {
  return new BackgroundTaskManager(join(runPath, "background-tasks.json"), workspacePath);
}
