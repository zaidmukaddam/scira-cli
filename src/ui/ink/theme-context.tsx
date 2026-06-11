import React, { createContext, useContext, useMemo, useState } from "react";
import { type SciraConfig } from "../../types/index.js";
import { probeTerminalTheme } from "./terminal-probe.js";
import {
  detectTerminalTheme,
  getTheme,
  getThemeFromResolved,
  watchAutoThemeChanges,
  type ThemeColors,
} from "./theme.js";

const ThemeCtx = createContext<ThemeColors>(getTheme("auto"));

type ThemeProviderProps = {
  config: SciraConfig;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  children: React.ReactNode;
};

export function ThemeProvider({ config, stdin, stdout, children }: ThemeProviderProps): React.ReactElement {
  const [autoResolved, setAutoResolved] = useState(detectTerminalTheme);
  const [probed, setProbed] = useState<"dark" | "light" | undefined>(undefined);

  React.useEffect(() => {
    if (config.theme !== "auto") {
      setProbed(undefined);
      return;
    }

    const sync = () => {
      void (async () => {
        const live = stdin && stdout ? await probeTerminalTheme(stdin, stdout) : undefined;
        setProbed((prev) => (prev === live ? prev : live));
        const next = live ?? detectTerminalTheme();
        setAutoResolved((prev) => (prev === next ? prev : next));
      })();
    };

    return watchAutoThemeChanges(sync);
  }, [config.theme, stdin, stdout]);

  const colors = useMemo(() => {
    if (config.theme !== "auto") return getTheme(config.theme);
    return getThemeFromResolved(probed ?? autoResolved);
  }, [config.theme, autoResolved, probed]);

  return <ThemeCtx.Provider value={colors}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeColors {
  return useContext(ThemeCtx);
}
