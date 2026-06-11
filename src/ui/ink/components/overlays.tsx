import React from "react";
import { Box, Text } from "ink";
import { RunState, SciraConfig } from "../../../types/index.js";
import { SPINNER_FRAMES, CHAT_COMMANDS, COMMAND_DESCRIPTIONS, MENU_VISIBLE } from "../constants.js";
import { fmtTokens, wrapText } from "../lib/utils.js";
import { LLM_PROVIDER_LABELS } from "../../../providers/llm/registry.js";
import { type ModelUsage } from "../types.js";
import { type Screen } from "../types.js";

type TopBarProps = {
  screen: Screen;
  runState: RunState | null;
  fullMode: boolean;
  activeUsage: ModelUsage | undefined;
  busy: boolean;
  frame: number;
  cwdDisplay: string;
};

export function TopBar({ screen, runState, fullMode, activeUsage, busy, frame, cwdDisplay }: TopBarProps): React.ReactElement {
  return (
    <Box paddingTop={1} justifyContent="space-between">
      <Box flexShrink={1} minWidth={0} marginRight={2}>
        <Text color="gray" dimColor wrap="truncate-end">
          {screen === "chat" ? (runState?.title || runState?.goal || cwdDisplay) : cwdDisplay}
        </Text>
      </Box>
      {screen === "chat" && (
        <Box flexShrink={0} gap={1}>
          <Text color="gray" dimColor>{"|"}</Text>
          <Text color={fullMode ? "magenta" : "#FFE0C2"}>{fullMode ? "full" : "quick"}</Text>
          {activeUsage && (
            <Text color="gray" dimColor>{`↑${fmtTokens(activeUsage.input)} ↓${fmtTokens(activeUsage.output)}`}</Text>
          )}
          {fullMode && (
            <Text color="gray" dimColor>
              {`src:${runState?.sourceCount ?? 0}`}
              {(runState?.claimCount ?? 0) > 0 ? ` · claims:${runState?.claimCount}` : ""}
            </Text>
          )}
          {fullMode && (
            <Text color={runState?.reportDirty ? "yellow" : "green"} dimColor>
              {runState?.reportDirty ? "draft" : "ready"}
            </Text>
          )}
          {busy && <Text color="#FFE0C2">{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>}
          <Text color="gray" dimColor>{"|"}</Text>
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
};

export function InputBar({ inputLines, cursorLine, cursorCol, showCursor, approvalPending, busy, frame, boxWidth, modelName }: InputBarProps): React.ReactElement {
  const accentColor = approvalPending ? "yellowBright" : busy ? "#C2AA93" : "gray";
  const borderLabel = busy ? `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${modelName}` : modelName;
  const labelMax = Math.max(0, boxWidth - 6);
  const label = borderLabel.length > labelMax ? borderLabel.slice(0, labelMax) : borderLabel;
  const dashCount = Math.max(1, boxWidth - label.length - 5);
  return (
    <Box flexDirection="column">
      <Text color={accentColor}>{"╭" + "─".repeat(Math.max(0, boxWidth - 2)) + "╮"}</Text>
      {inputLines.map((line, i) => (
        <Box key={i} width={boxWidth}>
          <Text color={accentColor}>{"│ "}</Text>
          <Text color={i === 0 ? (approvalPending ? "yellowBright" : busy ? "#C2AA93" : "#FFE0C2") : accentColor}>{i === 0 ? "❯ " : "  "}</Text>
          {showCursor && i === cursorLine ? (
            <>
              <Text color="white">{line.slice(0, cursorCol)}</Text>
              <Text color="white" inverse>{line[cursorCol] ?? " "}</Text>
              <Text color="white">{line.slice(cursorCol + 1)}</Text>
            </>
          ) : (
            <Text color={approvalPending ? "gray" : "white"}>{line}</Text>
          )}
          <Box flexGrow={1} />
          <Text color={accentColor}> │</Text>
        </Box>
      ))}
      <Box width={boxWidth}>
        <Text color={accentColor}>{"╰" + "─".repeat(dashCount) + " "}</Text>
        <Text color="#FFE0C2">{label}</Text>
        <Text color={accentColor}>{" ─╯"}</Text>
      </Box>
    </Box>
  );
}

export function HintLine({ screen, busy, scrollLabel, hasDoneGroups, hasFocusedGroup }: { screen: Screen; busy: boolean; scrollLabel?: string; hasDoneGroups?: boolean; hasFocusedGroup?: boolean }): React.ReactElement {
  if (screen === "chat") {
    return (
      <Box gap={1}>
        <Text color="gray" dimColor><Text bold color="#FFE0C2">/HELP</Text></Text>
        <Text color="gray" dimColor>{"|"}</Text>
        <Text color="gray" dimColor><Text bold color="#FFE0C2">/REPORT</Text></Text>
        <Text color="gray" dimColor>{"|"}</Text>
        <Text color="gray" dimColor><Text bold color="#FFE0C2">/NEW</Text></Text>
        {busy && (
          <>
            <Text color="gray" dimColor>{"|"}</Text>
            <Text color="gray" dimColor><Text bold color="#FFE0C2">/STOP</Text></Text>
          </>
        )}
        {hasDoneGroups && !busy ? (
          <>
            <Text color="gray" dimColor>{"|"}</Text>
            <Text color="gray" dimColor>
              {hasFocusedGroup
                ? <><Text bold color="#FFE0C2">C</Text> toggle · <Text bold color="#FFE0C2">ESC</Text> unfocus</>
                : <><Text bold color="#FFE0C2">[ ]</Text> · <Text bold color="#FFE0C2">C</Text> groups</>}
            </Text>
          </>
        ) : null}
        {scrollLabel ? (
          <>
            <Box flexGrow={1} />
            <Text color="gray" dimColor>{scrollLabel}</Text>
          </>
        ) : null}
      </Box>
    );
  }
  return (
    <Box gap={1}>
      <Text color="gray" dimColor><Text bold color="#FFE0C2">↑↓</Text>:navigate</Text>
      <Text color="gray" dimColor>{"|"}</Text>
      <Text color="gray" dimColor><Text bold color="#FFE0C2">⏎</Text>:open</Text>
      <Text color="gray" dimColor>{"|"}</Text>
      <Text color="gray" dimColor><Text bold color="#FFE0C2">ESC</Text>:close</Text>
      <Text color="gray" dimColor>{"|"}</Text>
      <Text color="gray" dimColor><Text bold color="#FFE0C2">Q</Text>:quit</Text>
    </Box>
  );
}

type CommandMenuBoxProps = {
  activeSuggestions: string[];
  activeSuggestionKind: "file" | "command" | "session" | null;
  commandMenuIndex: number;
  innerWidth: number;
  sessions?: RunState[];
};

export function CommandMenuBox({ activeSuggestions, activeSuggestionKind, commandMenuIndex, innerWidth, sessions }: CommandMenuBoxProps): React.ReactElement | null {
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
      : "commands  ↑↓ move · tab complete";
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
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginX={1}>
      <Text color="gray" dimColor>{header}{windowStart > 0 ? "  ↑" : ""}{windowStart + MENU_VISIBLE < total ? "  ↓" : ""}</Text>
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
            <Text color={active ? "white" : "gray"} bold={active}>{active ? "❯ " : "  "}{label}</Text>
            <Text color="gray" dimColor>{namePad}{trimmed}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

export function HelpBox({ open, innerWidth }: { open: boolean; innerWidth: number }): React.ReactElement | null {
  if (!open) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginX={1}>
      <Text bold color="white">help <Text color="gray" dimColor>esc close</Text></Text>
      <Text color="gray" dimColor>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      <Text color="gray" dimColor>scroll  ↑/↓  k/j  u/d  pgup/pgdn</Text>
      <Text color="gray" dimColor>autocomplete  / commands · @ files · # sessions</Text>
      <Text color="gray" dimColor>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      {CHAT_COMMANDS.map((cmd) => (
        <Box key={cmd} gap={2}>
          <Text color="#FFE0C2">{cmd}</Text>
          <Text color="gray" dimColor>{COMMAND_DESCRIPTIONS[cmd]}</Text>
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

export function ApprovalBox({ toolName, description, innerWidth }: ApprovalBoxProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellowBright" paddingX={1} marginX={1}>
      <Text bold color="yellowBright">⚠  {toolName}<Text color="gray" dimColor>  y approve · n reject</Text></Text>
      <Text color="gray" dimColor>{"─".repeat(Math.max(10, innerWidth - 6))}</Text>
      {wrapText(description, Math.max(10, innerWidth - 4)).slice(0, 6).map((line, i) => {
        const isAdded = line.startsWith("+ ");
        const isRemoved = line.startsWith("- ");
        return (
          <Text key={i} color={isAdded ? "green" : isRemoved ? "red" : "gray"} wrap="truncate">{line}</Text>
        );
      })}
    </Box>
  );
}

type MenuDialogProps = {
  menu: { type: "model" | "provider" | "llm"; items: string[]; index: number; loading?: boolean; query: string } | null;
  cols: number;
  rows: number;
};

export function MenuDialog({ menu, cols, rows }: MenuDialogProps): React.ReactElement | null {
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
  return (
    <Box
      position="absolute"
      marginLeft={dialogLeft}
      marginTop={dialogTop}
      width={DIALOG_W}
      flexDirection="column"
      borderStyle="round"
      borderColor="#FFE0C2"
      backgroundColor="#0d0d0d"
      paddingX={1}
    >
      <Text bold color="white">
        {menu.type === "model" ? "Select model" : menu.type === "llm" ? "Select LLM provider" : "Select search provider"}
        {"  "}<Text color="gray" dimColor>↑↓ navigate · ⏎ apply · esc close</Text>
      </Text>
      {!menu.loading && (
        <>
          <Box>
            <Text color="#FFE0C2">{"⌕ "}</Text>
            <Text color="white">{menu.query}</Text>
            {!menu.query && <Text color="gray" dimColor>type to filter…</Text>}
          </Box>
          <Text color="gray" dimColor>{"─".repeat(Math.max(4, DIALOG_W - 4))}</Text>
        </>
      )}
      {menu.loading ? (
        <Text color="gray" dimColor>  loading models…</Text>
      ) : menuFiltered.length === 0 ? (
        <Text color="gray" dimColor>  no matches for "{menu.query}"</Text>
      ) : (
        <>
          {menuStart > 0 && <Text color="gray" dimColor>  ↑ {menuStart} more</Text>}
          {menuFiltered.slice(menuStart, menuStart + DIALOG_ITEMS).map((item, i) => {
            const idx = menuStart + i;
            const active = idx === menu.index;
            return (
              <Text key={item} color={active ? "#FFE0C2" : "gray"} bold={active} wrap="truncate">
                {active ? "❯ " : "  "}{displayName(item)}
                {menu.type === "llm" ? <Text color="gray" dimColor>{"  " + item}</Text> : null}
              </Text>
            );
          })}
          {menuFiltered.length - (menuStart + DIALOG_ITEMS) > 0 && (
            <Text color="gray" dimColor>  ↓ {menuFiltered.length - (menuStart + DIALOG_ITEMS)} more</Text>
          )}
        </>
      )}
    </Box>
  );
}

export function McpDialog({ open, config, cols, rows }: { open: boolean; config: SciraConfig; cols: number; rows: number }): React.ReactElement | null {
  if (!open) return null;
  const W = Math.min(92, Math.max(52, cols - 8));
  const left = Math.max(0, Math.floor((cols - 4 - W) / 2));
  const servers = config.mcp.servers;
  const top = Math.max(1, Math.floor((rows - (8 + servers.length)) / 2));
  const dt = config.mcp.chromeDevtools;
  return (
    <Box position="absolute" marginLeft={left} marginTop={top} width={W} flexDirection="column" borderStyle="round" borderColor="#FFE0C2" backgroundColor="#0d0d0d" paddingX={1}>
      <Text bold color="white">MCP servers <Text color="gray" dimColor>esc/q/enter close</Text></Text>
      <Text color="gray" dimColor>{"─".repeat(Math.max(4, W - 4))}</Text>
      <Text wrap="truncate">
        <Text color={dt.enabled ? "green" : "gray"}>{dt.enabled ? "●" : "○"}</Text>
        <Text color="white"> chromeDevtools </Text>
        <Text color="#FFE0C2">[stdio] </Text>
        <Text color="gray" dimColor>{[dt.command, ...dt.args].join(" ")}</Text>
      </Text>
      {servers.length === 0 ? (
        <Text color="gray" dimColor>  no user-defined servers</Text>
      ) : servers.map((s) => {
        const target = s.transport === "stdio" ? [s.command, ...s.args].filter(Boolean).join(" ") : s.url ?? "(missing url)";
        return (
          <Text key={s.name} wrap="truncate">
            <Text color={s.enabled ? "green" : "gray"}>{s.enabled ? "●" : "○"}</Text>
            <Text color="white"> {s.name} </Text>
            <Text color="#FFE0C2">[{s.transport}] </Text>
            <Text color="gray" dimColor>{target}</Text>
          </Text>
        );
      })}
      <Text color="gray" dimColor>{"─".repeat(Math.max(4, W - 4))}</Text>
      <Text color="gray" dimColor>/mcp add http exa https://mcp.exa.ai/mcp</Text>
      <Text color="gray" dimColor>/mcp enable &lt;name&gt; · /mcp disable &lt;name&gt;</Text>
    </Box>
  );
}
