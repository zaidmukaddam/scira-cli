import { afterEach, describe, expect, it, vi } from "vitest";
import { detectTerminalTheme, getTheme, watchAutoThemeChanges } from "./theme.js";

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
    expect(getTheme("auto").text).toBe("black");
    expect(getTheme("auto").inputText).toBe("#000000");
    expect(getTheme("auto").userBandBackground).toBe("#f0f0f0");
    process.env.COLORFGBG = "15;0";
    expect(getTheme("auto").text).toBe("white");
    expect(getTheme("auto").inputText).toBe("#ffffff");
    expect(getTheme("auto").userBandBackground).toBe("ansi256(238)");
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
