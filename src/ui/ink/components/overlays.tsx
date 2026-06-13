import React from "react";
import { Box, Text } from "ink";
import { RunState, SciraConfig } from "../../../types/index.js";
import { SPINNER_FRAMES, CHAT_COMMANDS, COMMAND_DESCRIPTIONS, MENU_VISIBLE } from "../constants.js";
import { fmtTokens, wrapText, displayWidth } from "../lib/utils.js";
import { LLM_PROVIDER_LABELS } from "../../../providers/llm/registry.js";
import { type ModelUsage } from "../types.js";
import { type Screen } from "../types.js";
import { useTheme } from "../hooks/use-theme.js";
import { type ClickHandler } from "../hooks/use-mouse.js";

type TopBarProps = {
  screen: Screen;
  runState: RunState | null;
  fullMode: boolean;
  planMode: boolean;
  activeUsage: ModelUsage | undefined;
  busy: boolean;
  frame: number;
  cwdDisplay: string;
  config: SciraConfig;
};

export function TopBar({ screen, runState, fullMode, planMode, activeUsage, busy, frame, cwdDisplay, config }: TopBarProps): React.ReactElement {
  const theme = useTheme();
  return (
    <Box paddingTop={1} justifyContent="space-between">
      <Box flexShrink={1} minWidth={0} marginRight={2}>
        <Text color={theme.textDim} wrap="truncate-end">
          {screen === "chat" ? (runState?.title || runState?.goal || cwdDisplay) : cwdDisplay}
        </Text>
      </Box>
      {screen === "chat" && (
        <Box flexShrink={0} gap={1}>
          <Text color={theme.textDim}>{"|"}</Text>
          <Text color={fullMode ? "magenta" : theme.accent}>{fullMode ? "full" : "quick"}</Text>
          {planMode && <Text color="cyan">plan</Text>}
          {activeUsage && (
            <Text color={theme.textDim}>{`↑${fmtTokens(activeUsage.input)} ↓${fmtTokens(activeUsage.output)}`}</Text>
          )}
          {fullMode && (
            <Text color={theme.textDim}>
              {`src:${runState?.sourceCount ?? 0}`}
              {(runState?.claimCount ?? 0) > 0 ? ` · claims:${runState?.claimCount}` : ""}
            </Text>
          )}
          {fullMode && (
            <Text color={runState?.reportDirty ? theme.warning : theme.success}>
              {runState?.reportDirty ? "draft" : "ready"}
            </Text>
          )}
          {busy && <Text color={theme.accent}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>}
          <Text color={theme.textDim}>{"|"}</Text>
        </Box>
      )}
    </Box>
  );
}

type InputBarProps = {
  inputLines: string[];
  cursorLine: number;
  cursorCol: number;
  showCursor: boolean;
  approvalPending: boolean;
  busy: boolean;
  frame: number;
  boxWidth: number;
  modelName: string;
  planMode?: boolean;
  config: SciraConfig;
};

export function InputBar({ inputLines, cursorLine, cursorCol, showCursor, approvalPending, busy, frame, boxWidth, modelName, planMode, config }: InputBarProps): React.ReactElement {
  const theme = useTheme();
  // Plan mode tints the whole input box (unless an approval/busy state takes precedence).
  const borderColor = approvalPending ? theme.warning : busy ? theme.accentDim : planMode ? "cyan" : theme.textDim;
  const promptColor = approvalPending ? theme.warning : busy ? theme.accentDim : planMode ? "cyan" : theme.accent;
  const inputColor = approvalPending ? theme.textDim : theme.inputText;
  const planTag = planMode ? "plan ◆ " : "";
  const borderLabel = busy ? `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${planTag}${modelName}` : `${planTag}${modelName}`;
  const labelMax = Math.max(0, boxWidth - 6);
  const label = borderLabel.length > labelMax ? borderLabel.slice(0, labelMax) : borderLabel;
  const dashCount = Math.max(1, boxWidth - label.length - 5);
  return (
    <Box flexDirection="column">
      <Text color={borderColor}>{"╭" + "─".repeat(Math.max(0, boxWidth - 2)) + "╮"}</Text>
      {inputLines.map((line, i) => (
        <Box key={i} width={boxWidth}>
          <Text color={borderColor}>{"│ "}</Text>
          <Text color={i === 0 ? promptColor : borderColor}>{i === 0 ? "❯ " : "  "}</Text>
          <Box flexGrow={1} minWidth={0}>
            {showCursor && i === cursorLine ? (
              <Text wrap="truncate">
                <Text color={inputColor}>{line.slice(0, cursorCol)}</Text>
                <Text backgroundColor={theme.cursorBackground} color={theme.cursorForeground}>
                  {line[cursorCol] ?? " "}
                </Text>
                <Text color={inputColor}>{line.slice(cursorCol + 1)}</Text>
              </Text>
            ) : (
              <Text color={inputColor} wrap="truncate">{line}</Text>
            )}
          </Box>
          <Box flexGrow={1} />
          <Text color={borderColor}> │</Text>
        </Box>
      ))}
      <Box width={boxWidth}>
        <Text color={borderColor}>{"╰" + "─".repeat(dashCount) + " "}</Text>
        <Text color={planMode ? "cyan" : theme.accent}>{label}</Text>
        <Text color={borderColor}>{" ─╯"}</Text>
      </Box>
    </Box>
  );
}

export function HintLine({ screen, busy, scrollLabel, hasDoneGroups, hasFocusedGroup, hasLinkHover, alwaysAllowLinks, modeLabel, modeColor, config }: { screen: Screen; busy: boolean; scrollLabel?: string; hasDoneGroups?: boolean; hasFocusedGroup?: boolean; hasLinkHover?: boolean; alwaysAllowLinks?: boolean; modeLabel?: string; modeColor?: string; config: SciraConfig }): React.ReactElement {
  const theme = useTheme();
  const modeChip = modeLabel ? <Text backgroundColor={modeColor ?? "cyan"} color={theme.background} bold>{` ${modeLabel} `}</Text> : null;
  if (screen === "chat") {
    return (
      <Box gap={1}>
        <Text color={theme.textDim}><Text bold color={theme.accent}>/HELP</Text></Text>
        <Text color={theme.textDim}>{"|"}</Text>
        <Text color={theme.textDim}><Text bold color={theme.accent}>/REPORT</Text></Text>
        <Text color={theme.textDim}>{"|"}</Text>
        <Text color={theme.textDim}><Text bold color={theme.accent}>/NEW</Text></Text>
        {hasLinkHover && !busy ? (
          <>
            <Text color={theme.textDim}>{"|"}</Text>
            <Text color={theme.textDim}>
              {alwaysAllowLinks
                ? "click link to open"
                : <>click link · <Text bold color={theme.accent}>a</Text> always · <Text bold color={theme.accent}>y</Text> open · <Text bold color={theme.accent}>n</Text> cancel</>}
            </Text>
          </>
        ) : null}
        {busy && (
          <>
            <Text color={theme.textDim}>{"|"}</Text>
            <Text color={theme.textDim}><Text bold color={theme.accent}>/STOP</Text></Text>
          </>
        )}
        {hasDoneGroups && !busy ? (
          <>
            <Text color={theme.textDim}>{"|"}</Text>
            <Text color={theme.textDim}>
              {hasFocusedGroup
                ? <><Text bold color={theme.accent}>C</Text> toggle · <Text bold color={theme.accent}>ESC</Text> unfocus</>
                : <><Text bold color={theme.accent}>[ ]</Text> · <Text bold color={theme.accent}>C</Text> groups</>}
            </Text>
          </>
        ) : null}
        {(modeChip || scrollLabel) ? <Box flexGrow={1} /> : null}
        {modeChip}
        {scrollLabel ? <Text color={theme.textDim}>{scrollLabel}</Text> : null}
      </Box>
    );
  }
  return (
    <Box gap={1}>
      <Text color={theme.textDim}><Text bold color={theme.accent}>↑↓</Text>:navigate</Text>
      <Text color={theme.textDim}>{"|"}</Text>
      <Text color={theme.textDim}><Text bold color={theme.accent}>⏎</Text>:open</Text>
      <Text color={theme.textDim}>{"|"}</Text>
      <Text color={theme.textDim}><Text bold color={theme.accent}>ESC</Text>:close</Text>
      <Text color={theme.textDim}>{"|"}</Text>
      <Text color={theme.textDim}><Text bold color={theme.accent}>^D</Text>:quit</Text>
      {modeChip ? <><Box flexGrow={1} />{modeChip}</> : null}
    </Box>
  );
}

type CommandMenuBoxProps = {
  activeSuggestions: string[];
  activeSuggestionKind: "file" | "command" | "session" | null;
  commandMenuIndex: number;
  innerWidth: number;
  sessions?: RunState[];
  config: SciraConfig;
};

export function CommandMenuBox({ activeSuggestions, activeSuggestionKind, commandMenuIndex, innerWidth, sessions, config }: CommandMenuBoxProps): React.ReactElement | null {
  const theme = useTheme();
  if (activeSuggestions.length === 0) return null;
  const total = activeSuggestions.length;
  const clampedIdx = Math.min(Math.max(0, commandMenuIndex), total - 1);
  const windowStart = Math.max(0, Math.min(clampedIdx - MENU_VISIBLE + 1, total - MENU_VISIBLE));
  const visible = activeSuggestions.slice(windowStart, windowStart + MENU_VISIBLE);
  const nameWidth = Math.min(40, Math.max(...visible.map((c) => c.length)));
  const innerCols = Math.max(20, innerWidth - 4);
  const descMax = Math.max(10, innerCols - nameWidth - 4);
  const isFileMenu = activeSuggestionKind === "file";
  const isSessionMenu = activeSuggestionKind === "session";
  const baseHeader = isFileMenu ? "files  ↑↓ move · tab complete"
    : isSessionMenu ? "sessions  ↑↓ move · ⏎ open"
      : "commands  ↑↓ move · tab complete · ⏎ run";
  const header = total > MENU_VISIBLE ? `${baseHeader}  ·  ${clampedIdx + 1}/${total}` : baseHeader;
  const sessionDesc = (label: string): string => {
    const s = sessions?.find((r) => (r.title ?? r.goal ?? r.id).replace(/\s+/gu, " ").trim() === label);
    if (!s) return "";
    const bits = [s.isFull ? "full" : "quick"];
    if (s.sourceCount > 0) bits.push(`${s.sourceCount} src`);
    if (s.claimCount > 0) bits.push(`${s.claimCount} claims`);
    return bits.join(" · ");
  };
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text color={theme.textDim}>{header}{windowStart > 0 ? "  ↑" : ""}{windowStart + MENU_VISIBLE < total ? "  ↓" : ""}</Text>
      {visible.map((item, i) => {
        const gi = windowStart + i;
        const active = gi === clampedIdx;
        const name = isSessionMenu && item.length > nameWidth ? item.slice(0, Math.max(0, nameWidth - 1)) + "…" : item;
        const label = isFileMenu ? `@${name}` : isSessionMenu ? `# ${name}` : name;
        const desc = isFileMenu ? "Attach file as model context."
          : isSessionMenu ? sessionDesc(item)
            : COMMAND_DESCRIPTIONS[item] ?? "";
        const trimmed = desc.length > descMax ? desc.slice(0, Math.max(0, descMax - 1)) + "…" : desc;
        const namePad = " ".repeat(Math.max(1, nameWidth - name.length + 2));
        return (
          <Text key={`${item}-${gi}`} wrap="truncate">
            <Text color={active ? theme.text : theme.textDim} bold={active}>{active ? "❯ " : "  "}{label}</Text>
            <Text color={theme.textDim}>{namePad}{trimmed}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

export function HelpBox({ open, innerWidth, config }: { open: boolean; innerWidth: number; config: SciraConfig }): React.ReactElement | null {
  const theme = useTheme();
  if (!open) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Text bold color={theme.text}>help <Text color={theme.textDim}>esc close</Text></Text>
      <Text color={theme.textDim}>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      <Text color={theme.textDim}>scroll  ↑/↓  k/j  u/d  pgup/pgdn</Text>
      <Text color={theme.textDim}>autocomplete  / commands · @ files · # sessions</Text>
      <Text color={theme.textDim}>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      {CHAT_COMMANDS.map((cmd) => (
        <Box key={cmd} gap={2}>
          <Text color={theme.accent}>{cmd}</Text>
          <Text color={theme.textDim}>{COMMAND_DESCRIPTIONS[cmd]}</Text>
        </Box>
      ))}
    </Box>
  );
}

type ApprovalBoxProps = {
  toolName: string;
  description: string;
  innerWidth: number;
};

export function LinkOpenBox({ url, innerWidth, config }: { url: string; innerWidth: number; config: SciraConfig }): React.ReactElement {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text bold color={theme.accent}>↗ Open in browser?<Text color={theme.textDim}>  a always · y open · n cancel</Text></Text>
      <Text color={theme.textDim}>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      {wrapText(url, Math.max(10, innerWidth - 4)).slice(0, 4).map((line, i) => (
        <Text key={i} color={theme.text} wrap="truncate">{line}</Text>
      ))}
    </Box>
  );
}

export function ApprovalBox({ toolName, description, innerWidth, config }: { toolName: string; description: string; innerWidth: number; config: SciraConfig }): React.ReactElement {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warning} paddingX={1}>
      <Text bold color={theme.warning}>⚠  {toolName}<Text color={theme.textDim}>  y approve · n reject</Text></Text>
      <Text color={theme.textDim}>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      {wrapText(description, Math.max(10, innerWidth - 4)).slice(0, 6).map((line, i) => {
        const isAdded = line.startsWith("+ ");
        const isRemoved = line.startsWith("- ");
        return (
          <Text key={i} color={isAdded ? theme.success : isRemoved ? theme.error : theme.textDim} wrap="truncate">{line}</Text>
        );
      })}
    </Box>
  );
}

type MenuDialogProps = {
  menu: { type: "model" | "provider" | "llm"; items: string[]; index: number; loading?: boolean; query: string } | null;
  cols: number;
  rows: number;
  config: SciraConfig;
};

export function MenuDialog({ menu, cols, rows, config }: MenuDialogProps): React.ReactElement | null {
  const theme = useTheme();
  if (!menu) return null;
  const DIALOG_W = Math.min(64, Math.max(40, cols - 4));
  const DIALOG_ITEMS = 10;
  const displayName = (item: string): string =>
    menu.type === "llm" ? (LLM_PROVIDER_LABELS as Record<string, string>)[item] ?? item : item;
  const menuFiltered = !menu.loading
    ? (menu.query
      ? menu.items.filter((item) =>
        item.toLowerCase().includes(menu.query.toLowerCase()) ||
        displayName(item).toLowerCase().includes(menu.query.toLowerCase()))
      : menu.items)
    : [];
  const menuStart = Math.min(Math.max(0, menu.index - Math.floor(DIALOG_ITEMS / 2)), Math.max(0, menuFiltered.length - DIALOG_ITEMS));
  const dialogLeft = Math.max(0, Math.floor((cols - 4 - DIALOG_W) / 2));
  const dialogH = 5 + (menu.loading ? 1 : Math.min(DIALOG_ITEMS, menuFiltered.length) + (menuStart > 0 ? 1 : 0) + (menuFiltered.length - (menuStart + DIALOG_ITEMS) > 0 ? 1 : 0));
  const dialogTop = Math.max(1, Math.floor((rows - dialogH) / 2));
  const bg = theme.userBandBackground ? { backgroundColor: theme.userBandBackground } : {};
  const innerW = DIALOG_W - 2; // cells between the two border columns
  // Draw the border as characters inside full-width background lines (like
  // InputBar). Ink's box border + backgroundColor leaves unfilled gaps, so we
  // compose each line ourselves: every line is one solid Text spanning DIALOG_W.
  const line = (key: string, visibleLen: number, content: React.ReactNode): React.ReactElement => (
    <Text key={key} {...bg} wrap="truncate">
      <Text color={theme.accent}>│</Text>
      <Text> </Text>
      {content}
      <Text>{" ".repeat(Math.max(0, innerW - 1 - visibleLen))}</Text>
      <Text color={theme.accent}>│</Text>
    </Text>
  );

  // Clip a string to at most `max` display columns (so a row never overruns the
  // border on narrow terminals — wrap="truncate" would eat the closing │).
  const clip = (s: string, max: number): string => {
    if (max <= 0) return "";
    if (displayWidth(s) <= max) return s;
    let out = "", w = 0;
    for (const ch of s) {
      const cw = displayWidth(ch);
      if (w + cw > max - 1) break; // leave a column for the ellipsis
      out += ch; w += cw;
    }
    return out + "…";
  };
  const avail = innerW - 1; // usable columns after the leading space

  const title = menu.type === "model" ? "Select model" : menu.type === "llm" ? "Select LLM provider" : "Select search provider";
  const hint = "↑↓ navigate · ⏎ apply · esc close";

  const dialogLines: React.ReactElement[] = [];
  // Title + hint, dropping/clipping the (secondary) hint when space is tight.
  const titleC = clip(title, avail);
  const hintRoom = avail - displayWidth(titleC) - 2;
  const hintC = hintRoom >= 6 ? clip(hint, hintRoom) : "";
  dialogLines.push(line("title", displayWidth(titleC) + (hintC ? 2 + displayWidth(hintC) : 0), (
    <><Text bold color={theme.text}>{titleC}</Text>{hintC ? <Text color={theme.textDim}>{"  " + hintC}</Text> : null}</>
  )));
  if (!menu.loading) {
    const filterC = clip(menu.query || "type to filter…", avail - 2);
    dialogLines.push(line("filter", 2 + displayWidth(filterC), (
      <><Text color={theme.accent}>{"⌕ "}</Text>{menu.query ? <Text color={theme.inputText}>{filterC}</Text> : <Text color={theme.textDim}>{filterC}</Text>}</>
    )));
    dialogLines.push(line("divider", innerW - 1, <Text color={theme.textDim}>{"─".repeat(Math.max(4, innerW - 1))}</Text>));
  }
  if (menu.loading) {
    dialogLines.push(line("loading", displayWidth("loading models…"), <Text color={theme.textDim}>loading models…</Text>));
  } else if (menuFiltered.length === 0) {
    const msg = clip(`no matches for "${menu.query}"`, avail);
    dialogLines.push(line("empty", displayWidth(msg), <Text color={theme.textDim}>{msg}</Text>));
  } else {
    if (menuStart > 0) dialogLines.push(line("up", displayWidth(`↑ ${menuStart} more`), <Text color={theme.textDim}>{`↑ ${menuStart} more`}</Text>));
    menuFiltered.slice(menuStart, menuStart + DIALOG_ITEMS).forEach((item, i) => {
      const active = menuStart + i === menu.index;
      const marker = active ? "❯ " : "  ";
      const label = clip(displayName(item), avail - displayWidth(marker));
      const suffixRoom = avail - displayWidth(marker + label);
      const suffix = menu.type === "llm" && suffixRoom >= 4 ? clip("  " + item, suffixRoom) : "";
      dialogLines.push(line(item, displayWidth(marker + label) + displayWidth(suffix), (
        <>
          <Text color={active ? theme.accent : theme.textDim} bold={active}>{marker + label}</Text>
          {suffix ? <Text color={theme.textDim}>{suffix}</Text> : null}
        </>
      )));
    });
    const moreBelow = menuFiltered.length - (menuStart + DIALOG_ITEMS);
    if (moreBelow > 0) dialogLines.push(line("down", displayWidth(`↓ ${moreBelow} more`), <Text color={theme.textDim}>{`↓ ${moreBelow} more`}</Text>));
  }

  return (
    <Box position="absolute" marginLeft={dialogLeft} marginTop={dialogTop} width={DIALOG_W} flexDirection="column">
      <Text {...bg}><Text color={theme.accent}>{"╭" + "─".repeat(innerW) + "╮"}</Text></Text>
      {dialogLines}
      <Text {...bg}><Text color={theme.accent}>{"╰" + "─".repeat(innerW) + "╯"}</Text></Text>
    </Box>
  );
}

export type McpDialogRow = {
  key: string;
  name: string;
  transport: string;
  target: string;
  enabled: boolean;
  removable: boolean;
};

export function buildMcpDialogRows(config: SciraConfig): McpDialogRow[] {
  const dt = config.mcp.chromeDevtools;
  const rows: McpDialogRow[] = [{
    key: "chromeDevtools",
    name: "chromeDevtools",
    transport: "stdio",
    target: [dt.command, ...dt.args].join(" "),
    enabled: dt.enabled,
    removable: false,
  }];
  for (const s of config.mcp.servers) {
    rows.push({
      key: s.name,
      name: s.name,
      transport: s.transport,
      target: s.transport === "stdio"
        ? [s.command, ...s.args].filter(Boolean).join(" ")
        : s.url ?? "(missing url)",
      enabled: s.enabled,
      removable: true,
    });
  }
  return rows;
}

type McpDialogProps = {
  open: boolean;
  config: SciraConfig;
  cols: number;
  rows: number;
  selectedIdx: number;
  hoveredIdx: number | null;
  onToggle: (row: McpDialogRow) => void;
  onRemove: (row: McpDialogRow) => void;
  clickMapRef: React.RefObject<Map<number, ClickHandler>>;
  hoverMapRef: React.RefObject<Map<number, number>>;
};

export function McpDialog({
  open, config, cols, rows, selectedIdx, hoveredIdx, onToggle, onRemove, clickMapRef, hoverMapRef,
}: McpDialogProps): React.ReactElement | null {
  const theme = useTheme();
  if (!open) return null;

  const W = Math.min(92, Math.max(52, cols - 8));
  const left = Math.max(0, Math.floor((cols - 4 - W) / 2));
  const entries = buildMcpDialogRows(config);
  const top = Math.max(1, Math.floor((rows - (8 + entries.length)) / 2));
  const deleteCol = left + W - 5;
  const checkboxCol = left + 4;

  const clickMap = new Map<number, (x: number) => void>();
  const hoverMap = new Map<number, number>();
  const firstRow = top + 2;
  entries.forEach((row, i) => {
    const termRow = firstRow + i;
    hoverMap.set(termRow, i);
    clickMap.set(termRow, (x) => {
      if (row.removable && x >= deleteCol) onRemove(row);
      else if (x <= checkboxCol + 2) onToggle(row);
      else onToggle(row);
    });
  });
  clickMapRef.current = clickMap;
  hoverMapRef.current = hoverMap;

  return (
    <Box position="absolute" marginLeft={left} marginTop={top} width={W} flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} paddingY={1} {...(theme.userBandBackground ? { backgroundColor: theme.userBandBackground } : {})}>
      <Text bold color={theme.text}>
        MCP servers <Text color={theme.textDim}>↑↓ · space toggle · x remove · esc close</Text>
      </Text>
      <Text color={theme.textDim}>{"─".repeat(Math.max(4, W - 4))}</Text>
      {entries.map((row, i) => {
        const active = i === selectedIdx || hoveredIdx === i;
        const check = row.enabled ? "x" : " ";
        return (
          <Box key={row.key} width={W - 2} flexDirection="row">
            <Box flexGrow={1} minWidth={0}>
              <Text wrap="truncate">
                <Text color={active ? theme.text : theme.textDim}>{active ? "❯ " : "  "}</Text>
                <Text color={active ? theme.accent : theme.textDim} bold={active}>[{check}]</Text>
                <Text color={theme.text}> {row.name} </Text>
                <Text color={theme.accent}>[{row.transport}] </Text>
                <Text color={theme.textDim}>{row.target}</Text>
              </Text>
            </Box>
            {row.removable ? (
              <Text color={active ? theme.warning : theme.textDim}> [x]</Text>
            ) : null}
          </Box>
        );
      })}
      {entries.length === 1 ? (
        <Text color={theme.textDim}>  no user-defined servers</Text>
      ) : null}
      <Text color={theme.textDim}>{"─".repeat(Math.max(4, W - 4))}</Text>
      <Text color={theme.textDim}>/mcp add http exa https://mcp.exa.ai/mcp</Text>
    </Box>
  );
}
