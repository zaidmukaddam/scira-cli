import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Theme = "dark" | "light" | "auto";

export interface ThemeColors {
  accent: string;
  accentDim: string;
  background?: string;
  border: string;
  text: string;
  textDim: string;
  textInverse: string;
  /** Typed input foreground — ansi256 for broad terminal compatibility. */
  inputText: string;
  cursorBackground: string;
  cursorForeground: string;
  success: string;
  warning: string;
  error: string;
  modalBackground?: string;
  userBandBackground?: string;
}

export const DARK_THEME: ThemeColors = {
  accent: "#FFE0C2",
  accentDim: "#CFB59D",
  background: "",
  border: "#FFE0C2",
  text: "ansi256(15)",
  textDim: "ansi256(245)",
  textInverse: "ansi256(0)",
  inputText: "ansi256(15)",
  cursorBackground: "#FFE0C2",
  cursorForeground: "#000000",
  success: "green",
  warning: "yellow",
  error: "red",
  modalBackground: "",
  userBandBackground: "ansi256(238)",
};

export const LIGHT_THEME: ThemeColors = {
  accent: "#FFE0C2",
  accentDim: "#CFB59D",
  background: "",
  border: "#FFE0C2",
  text: "ansi256(0)",
  textDim: "ansi256(242)",
  textInverse: "ansi256(15)",
  inputText: "ansi256(0)",
  cursorBackground: "#CFB59D",
  cursorForeground: "#000000",
  success: "green",
  warning: "yellow",
  error: "red",
  modalBackground: "",
  userBandBackground: "#f0f0f0",
};

function inferThemeFromName(name: string): "dark" | "light" | undefined {
  const n = name.toLowerCase();
  if (/\blight\b|day\b|solarized light|github light/i.test(n)) return "light";
  if (/\bdark\b|night\b|dim\b|solarized dark|github dark|monokai|dracula|one dark/i.test(n)) return "dark";
  return undefined;
}

function readColorFgbg(): "dark" | "light" | undefined {
  const colorfgbg = process.env.COLORFGBG;
  if (!colorfgbg) return undefined;
  const parts = colorfgbg.split(";");
  const bg = parts[1];
  if (!bg) return undefined;
  const bgNum = parseInt(bg, 10);
  if (Number.isNaN(bgNum)) return undefined;
  if (bgNum === 0 || bgNum === 8) return "dark";
  if (bgNum === 7 || bgNum === 15) return "light";
  return undefined;
}

function readTerminalProfile(): "dark" | "light" | undefined {
  const profile = process.env.TERM_PROFILE || process.env.ITERM_PROFILE || process.env.WARP_BOOTSTRAPPED || "";
  if (!profile) return undefined;
  if (/light|day|solar/i.test(profile)) return "light";
  if (/dark|night|dim/i.test(profile)) return "dark";
  return undefined;
}

/** Common standalone terminals that default to dark profiles when unset. */
function readTermProgram(): "dark" | "light" | undefined {
  const program = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  if (!program) return undefined;
  if (/warp|ghostty|alacritty|kitty|hyper|wezterm|tabby/.test(program)) return "dark";
  if (program === "apple_terminal") return "dark";
  return undefined;
}

function editorSettingsPaths(): string[] {
  const home = homedir();
  if (process.platform === "darwin") {
    return [
      join(home, "Library/Application Support/Cursor/User/settings.json"),
      join(home, "Library/Application Support/Code/User/settings.json"),
    ];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return [
      join(appData, "Cursor/User/settings.json"),
      join(appData, "Code/User/settings.json"),
    ];
  }
  return [
    join(home, ".config/Cursor/User/settings.json"),
    join(home, ".config/Code/User/settings.json"),
  ];
}

function readEditorColorTheme(): "dark" | "light" | undefined {
  if (process.env.TERM_PROGRAM !== "vscode") return undefined;
  for (const path of editorSettingsPaths()) {
    try {
      const settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const theme = settings["workbench.colorTheme"];
      if (typeof theme !== "string") continue;
      const inferred = inferThemeFromName(theme);
      if (inferred) return inferred;
    } catch {
      // try next settings file
    }
  }
  return undefined;
}

function readSystemAppearance(): "dark" | "light" | undefined {
  if (process.platform === "darwin") {
    try {
      const r = Bun.spawnSync(["defaults", "read", "-g", "AppleInterfaceStyle"], { stdout: "pipe", stderr: "ignore" });
      // The key is absent (and `defaults` exits non-zero) in light mode.
      return r.stdout.toString().trim() === "Dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }
  if (process.platform === "linux") {
    try {
      const r = Bun.spawnSync(["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"], { stdout: "pipe", stderr: "ignore" });
      const scheme = r.stdout.toString().trim();
      if (/dark/i.test(scheme)) return "dark";
      if (/light/i.test(scheme)) return "light";
    } catch {
      // fall through
    }
    const gtk = process.env.GTK_THEME;
    if (gtk && /dark/i.test(gtk)) return "dark";
  }
  return undefined;
}

export function detectTerminalTheme(): "dark" | "light" {
  return readColorFgbg()
    ?? readTerminalProfile()
    ?? readTermProgram()
    ?? readEditorColorTheme()
    ?? readSystemAppearance()
    ?? "dark";
}

/** Input foreground matched to terminal appearance. */
export function inputForegroundForAppearance(appearance: "dark" | "light"): string {
  return appearance === "dark" ? "ansi256(15)" : "ansi256(0)";
}

/**
 * Pick colors for rendering. When a locked theme disagrees with the terminal
 * background, follow the terminal so text stays readable.
 */
export function resolveRenderingAppearance(
  configTheme: Theme,
  terminalAppearance: "dark" | "light",
): "dark" | "light" {
  if (configTheme === "auto") return terminalAppearance;
  if (configTheme !== terminalAppearance) return terminalAppearance;
  return configTheme;
}

export function getThemeFromResolved(resolved: "dark" | "light"): ThemeColors {
  return resolved === "light" ? LIGHT_THEME : DARK_THEME;
}

export function getTheme(theme: Theme): ThemeColors {
  const resolved = theme === "auto" ? detectTerminalTheme() : theme;
  return getThemeFromResolved(resolved);
}

/** Poll editor settings + system appearance while theme mode is auto. */
export function watchAutoThemeChanges(onChange: () => void): () => void {
  const cleanups: Array<() => void> = [];
  onChange();

  if (process.env.TERM_PROGRAM === "vscode") {
    for (const path of editorSettingsPaths()) {
      try {
        watchFile(path, { interval: 400 }, onChange);
        cleanups.push(() => {
          try { unwatchFile(path); } catch { /* file may be gone */ }
        });
      } catch {
        // settings file not present yet
      }
    }
  }

  const id = setInterval(onChange, 1500);
  cleanups.push(() => clearInterval(id));

  return () => { cleanups.forEach((fn) => fn()); };
}
