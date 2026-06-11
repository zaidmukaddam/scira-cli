import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { execSync } from "node:child_process";
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
  /** Typed input foreground — explicit hex for terminal compatibility. */
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
  text: "white",
  textDim: "ansi256(245)",
  textInverse: "black",
  inputText: "#ffffff",
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
  text: "black",
  textDim: "gray",
  textInverse: "white",
  inputText: "#000000",
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
  const profile = process.env.TERM_PROFILE || process.env.ITERM_PROFILE || "";
  if (!profile) return undefined;
  if (/light|day|solar/i.test(profile)) return "light";
  if (/dark|night|dim/i.test(profile)) return "dark";
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
      const style = execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return style === "Dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }
  if (process.platform === "linux") {
    try {
      const scheme = execSync("gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
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
    ?? readEditorColorTheme()
    ?? readSystemAppearance()
    ?? "light";
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
