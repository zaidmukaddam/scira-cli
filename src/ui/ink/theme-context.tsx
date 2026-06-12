import React, { createContext, useContext, useMemo, useState } from "react";
import { type SciraConfig } from "../../types/index.js";
import {
  detectTerminalTheme,
  getThemeFromResolved,
  resolveRenderingAppearance,
  watchAutoThemeChanges,
  type ThemeColors,
} from "./theme.js";

type ThemeContextValue = {
  colors: ThemeColors;
  /** Detected terminal background (env/heuristics). */
  terminalAppearance: "dark" | "light";
  /** Appearance actually used for colors (may override a mismatched config.theme). */
  renderingAppearance: "dark" | "light";
};

const initialTerminal = detectTerminalTheme();

const ThemeCtx = createContext<ThemeContextValue>({
  colors: getThemeFromResolved(initialTerminal),
  terminalAppearance: initialTerminal,
  renderingAppearance: initialTerminal,
});

type ThemeProviderProps = {
  config: SciraConfig;
  children: React.ReactNode;
};

export function ThemeProvider({ config, children }: ThemeProviderProps): React.ReactElement {
  const [terminalAppearance, setTerminalAppearance] = useState(detectTerminalTheme);

  React.useEffect(() => {
    return watchAutoThemeChanges(() => {
      const next = detectTerminalTheme();
      setTerminalAppearance((prev) => (prev === next ? prev : next));
    });
  }, []);

  const value = useMemo((): ThemeContextValue => {
    const renderingAppearance = resolveRenderingAppearance(config.theme, terminalAppearance);
    return {
      colors: getThemeFromResolved(renderingAppearance),
      terminalAppearance,
      renderingAppearance,
    };
  }, [config.theme, terminalAppearance]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeColors {
  return useContext(ThemeCtx).colors;
}

export function useTerminalAppearance(): "dark" | "light" {
  return useContext(ThemeCtx).terminalAppearance;
}

export function useRenderingAppearance(): "dark" | "light" {
  return useContext(ThemeCtx).renderingAppearance;
}
