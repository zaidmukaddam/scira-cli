const OSC_BG_QUERY = "\x1b]11;?\x07";

export function parseOscBackgroundColor(raw: string): { r: number; g: number; b: number } | undefined {
  const trimmed = raw.trim();
  const rgb = /rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/.exec(trimmed);
  if (rgb) {
    const scale = (h: string) => {
      const expanded = h.length < 4 ? h.repeat(4 / h.length).slice(0, 4) : h.slice(0, 4);
      return Math.round(parseInt(expanded, 16) / 65535 * 255);
    };
    return { r: scale(rgb[1]), g: scale(rgb[2]), b: scale(rgb[3]) };
  }
  const hex = /#([0-9a-fA-F]{6})/.exec(trimmed);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
    };
  }
  return undefined;
}

export function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function themeFromLuminance(lum: number): "dark" | "light" {
  return lum > 0.55 ? "light" : "dark";
}

export function probeTerminalTheme(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  timeoutMs = 400,
): Promise<"dark" | "light" | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: "dark" | "light" | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      resolve(value);
    };

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === "string" ? chunk : chunk.toString();
      const match = /\x1b\]11;([^\x07\x1b]+)/.exec(str);
      if (!match) return;
      const color = parseOscBackgroundColor(match[1]);
      if (!color) return;
      finish(themeFromLuminance(luminance(color)));
    };

    const timer = setTimeout(() => finish(undefined), timeoutMs);
    stdin.on("data", onData);
    stdout.write(OSC_BG_QUERY);
  });
}
