import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectTerminalTheme,
  getTheme,
  inputForegroundForAppearance,
  resolveRenderingAppearance,
  watchAutoThemeChanges,
} from "./theme.js";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("detectTerminalTheme", () => {
  it("uses COLORFGBG when present", () => {
    process.env.COLORFGBG = "15;0";
    expect(detectTerminalTheme()).toBe("dark");
    process.env.COLORFGBG = "0;15";
    expect(detectTerminalTheme()).toBe("light");
  });

  it("prefers COLORFGBG over terminal profile hints", () => {
    process.env.COLORFGBG = "0;15";
    process.env.TERM_PROFILE = "Dark";
    expect(detectTerminalTheme()).toBe("light");
  });

  it("resolves auto theme colors from detected appearance", () => {
    process.env.COLORFGBG = "0;15";
    expect(getTheme("auto").text).toBe("ansi256(0)");
    expect(getTheme("auto").inputText).toBe("ansi256(0)");
    expect(getTheme("auto").userBandBackground).toBe("#f0f0f0");
    process.env.COLORFGBG = "15;0";
    expect(getTheme("auto").text).toBe("ansi256(15)");
    expect(getTheme("auto").inputText).toBe("ansi256(15)");
    expect(getTheme("auto").userBandBackground).toBe("ansi256(238)");
  });

  it("detects Warp and Apple Terminal as dark when unset", () => {
    delete process.env.COLORFGBG;
    delete process.env.TERM_PROFILE;
    delete process.env.ITERM_PROFILE;
    process.env.TERM_PROGRAM = "WarpTerminal";
    expect(detectTerminalTheme()).toBe("dark");
    process.env.TERM_PROGRAM = "Apple_Terminal";
    expect(detectTerminalTheme()).toBe("dark");
  });

  it("defaults to dark when no signals are present", () => {
    delete process.env.COLORFGBG;
    delete process.env.TERM_PROFILE;
    delete process.env.ITERM_PROFILE;
    delete process.env.TERM_PROGRAM;
    delete process.env.TERM_PROGRAM;
    expect(detectTerminalTheme()).toBe("dark");
  });

  it("maps terminal appearance to ansi256 input foreground", () => {
    expect(inputForegroundForAppearance("dark")).toBe("ansi256(15)");
    expect(inputForegroundForAppearance("light")).toBe("ansi256(0)");
  });

  it("overrides a mismatched locked theme to match the terminal", () => {
    expect(resolveRenderingAppearance("light", "dark")).toBe("dark");
    expect(resolveRenderingAppearance("dark", "light")).toBe("light");
    expect(resolveRenderingAppearance("dark", "dark")).toBe("dark");
    expect(resolveRenderingAppearance("auto", "dark")).toBe("dark");
  });

  it("watchAutoThemeChanges fires immediately and on interval", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = watchAutoThemeChanges(onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(1500);
    expect(onChange).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
