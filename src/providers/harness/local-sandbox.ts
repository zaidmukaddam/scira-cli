import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";

import type {
  Experimental_SandboxProcess as SandboxProcess,
  Experimental_SandboxSession as SandboxSession,
} from "@ai-sdk/provider-utils";
import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1SandboxProvider,
} from "@ai-sdk/harness";

/**
 * Runs the harness bridge (and therefore the bundled `claude`/`codex` runtime)
 * directly on the user's machine — same filesystem, same processes, same
 * network — instead of in a cloud sandbox.
 *
 * Note: the bridge ships its own copy of the Anthropic/OpenAI CLI and still
 * authenticates with the API key you pass to the adapter. This provider only
 * controls *where the bridge process runs*; it does not reuse the user's
 * globally installed CLI or its OAuth login.
 */
export type LocalSandboxOptions = {
  /**
   * Base directory the harness composes per-session work dirs under, as
   * `<rootDir>/<harnessId>-<sessionId>`. Defaults to the current working
   * directory. Point this at the repo you want the agent to operate on.
   */
  readonly rootDir?: string;
  /** Extra env handed to every spawned process. Merged over `process.env`. */
  readonly env?: Record<string, string>;
  /**
   * Env var names to delete from every spawned process's environment. Use this
   * to keep credentials out of the sandbox — e.g. stripping `ANTHROPIC_API_KEY`
   * so the bundled CLI falls back to the user's local login instead of a key.
   */
  readonly stripEnv?: readonly string[];
};

/** Ask the OS for a free TCP port by binding to :0, then release it for the bridge to claim. */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("Could not reserve a free port"))));
    });
  });
}

function spawnProcess(
  command: string,
  opts: { workingDirectory?: string; env?: Record<string, string>; abortSignal?: AbortSignal },
  rootDir: string,
  baseEnv: Record<string, string>,
  stripEnv: readonly string[],
): SandboxProcess {
  const env: Record<string, string | undefined> = { ...process.env, ...baseEnv, ...opts.env };
  for (const name of stripEnv) delete env[name];
  // Bun.spawn takes an argv array, not a shell string — wrap in the platform shell.
  const argv = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command];
  const proc = Bun.spawn(argv, {
    cwd: opts.workingDirectory ?? rootDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.abortSignal ? { signal: opts.abortSignal } : {}),
  });

  return {
    pid: proc.pid,
    // Bun.spawn pipes are already web ReadableStreams — no node:stream bridging.
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    wait: () => proc.exited.then((exitCode) => ({ exitCode })),
    kill: async () => {
      proc.kill();
    },
  };
}

function createLocalSession(rootDir: string, baseEnv: Record<string, string>, stripEnv: readonly string[]): SandboxSession {
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.join(rootDir, p));

  return {
    description:
      `Local machine sandbox. Root directory: ${rootDir}. Commands run as the ` +
      `current OS user with full local filesystem and network access.`,

    readFile: async ({ path: p }) => {
      const file = Bun.file(resolve(p));
      return (await file.exists()) ? file.stream() : null;
    },
    readBinaryFile: async ({ path: p }) => {
      try {
        return new Uint8Array(await fs.readFile(resolve(p)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    readTextFile: async ({ path: p, encoding = "utf-8", startLine, endLine }) => {
      let text: string;
      try {
        text = await fs.readFile(resolve(p), { encoding: encoding as BufferEncoding });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
      if (startLine === undefined && endLine === undefined) return text;
      const lines = text.split("\n");
      return lines.slice((startLine ?? 1) - 1, endLine ?? lines.length).join("\n");
    },

    writeFile: async ({ path: p, content }) => {
      await fs.mkdir(path.dirname(resolve(p)), { recursive: true });
      const chunks: Buffer[] = [];
      for await (const chunk of content as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      await fs.writeFile(resolve(p), Buffer.concat(chunks));
    },
    writeBinaryFile: async ({ path: p, content }) => {
      await fs.mkdir(path.dirname(resolve(p)), { recursive: true });
      await fs.writeFile(resolve(p), content);
    },
    writeTextFile: async ({ path: p, content, encoding = "utf-8" }) => {
      await fs.mkdir(path.dirname(resolve(p)), { recursive: true });
      await fs.writeFile(resolve(p), content, { encoding: encoding as BufferEncoding });
    },

    spawn: async (options) =>
      spawnProcess(options.command, options, rootDir, baseEnv, stripEnv),

    run: async (options) => {
      const proc = spawnProcess(options.command, options, rootDir, baseEnv, stripEnv);
      const [stdout, stderr, { exitCode }] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.wait(),
      ]);
      return { exitCode, stdout, stderr };
    },
  };
}

/**
 * A {@link HarnessV1SandboxProvider} that runs everything on the local machine.
 * Pair it with `claudeCode`/`codex` from the harness adapters.
 */
export function createLocalSandbox(options: LocalSandboxOptions = {}): HarnessV1SandboxProvider {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const baseEnv = options.env ?? {};
  const stripEnv = options.stripEnv ?? [];

  // A local "sandbox" has no durable remote resource — the bridge process is
  // the only state, and it dies with this process. So create and resume are the
  // same operation: a fresh bridge bound to the same rootDir. Cross-process
  // continuity comes from the adapter's resume state (the CLI's native session
  // id) replaying conversation history from ~/.claude / ~/.codex, plus the files
  // persisting on disk.
  const buildSession = async (): Promise<HarnessV1NetworkSandboxSession> => {
    await fs.mkdir(rootDir, { recursive: true });
    const session = createLocalSession(rootDir, baseEnv, stripEnv);

    // The bridge binds to a sandbox-declared TCP port. On a local sandbox we
    // reserve a free loopback port and advertise it; the bridge listens there
    // and we reach it over 127.0.0.1.
    const bridgePort = await reserveFreePort();

    return {
      ...session,
      id: `local-${path.basename(rootDir)}`,
      defaultWorkingDirectory: rootDir,
      ports: [bridgePort],
      getPortUrl: async ({ port, protocol = "http" }) => {
        const scheme = protocol === "ws" ? "ws" : protocol;
        return `${scheme}://127.0.0.1:${port}`;
      },
      stop: async () => {},
      destroy: async () => {},
      restricted: () => session,
    };
  };

  return {
    specificationVersion: "harness-sandbox-v1",
    providerId: "local-fs",
    createSession: buildSession,
    resumeSession: buildSession,
  };
}
