import React, { useMemo } from "react";
import { Text } from "ink";
import Link from "ink-link";
import { type FeedItem } from "../types.js";
import { type SciraConfig } from "../../../types/index.js";
import { S_BAR, TOOL_ICONS, SPINNER_FRAMES } from "../constants.js";
import { formatTime, fmtDuration, wrapText, computeLineLinks, displayWidth } from "../lib/utils.js";
import type { LineLink } from "../lib/utils.js";
import type { MdSeg } from "../lib/markdown.js";
import {
  formatToolResultLines, formatToolResultPreview, feedToolItemId,
  isCollapsibleToolName, isToolItemCollapsed,
} from "../lib/tool-result.js";
import { markdownToSegLines } from "../lib/markdown.js";
import { useTheme } from "./use-theme.js";
import type { ThemeColors } from "../theme.js";

export type GroupInfo = { stepLabels: string[]; itemCount: number; active: boolean; end: number };

export function computeGroups(feed: FeedItem[]): { groupOf: number[]; groups: Map<number, GroupInfo> } {
  const groupOf = new Array<number>(feed.length).fill(-1);
  const groups = new Map<number, GroupInfo>();
  let gs = -1;
  for (let i = 0; i < feed.length; i++) {
    const k = feed[i].kind;
    if (k === "tool" || k === "reasoning") {
      if (gs === -1) { gs = i; groups.set(gs, { stepLabels: [], itemCount: 0, active: false, end: i }); }
      const g = groups.get(gs)!;
      g.end = i;
      g.itemCount++;
      groupOf[i] = gs;
      if (k === "tool") {
        const it = feed[i] as Extract<FeedItem, { kind: "tool" }>;
        g.stepLabels.push(it.name);
        if (it.status === "running") g.active = true;
      } else {
        g.stepLabels.push("thinking");
        const it = feed[i] as Extract<FeedItem, { kind: "reasoning" }>;
        if (it.durationMs === undefined) g.active = true;
      }
    } else {
      gs = -1;
    }
  }
  return { groupOf, groups };
}

type GroupHeader = { _tag: "gh"; info: GroupInfo; key: number; collapsed: boolean; focused: boolean };
type EffFeedItem = { _tag: "fi"; idx: number; item: FeedItem };
type EffItem = EffFeedItem | GroupHeader;
const isGH = (item: EffItem): item is GroupHeader => item._tag === "gh";

function renderSegNodes(segs: MdSeg[], theme: ThemeColors, defaultColor: string): React.ReactNode[] {
  return segs.map((s, i) => {
    const inner = (
      <Text
        color={s.url ? (s.color ?? theme.accent) : (s.color ?? defaultColor)}
        bold={s.bold}
        italic={s.italic}
        underline={s.url ? true : s.underline}
        dimColor={s.dim}
      >
        {s.text}
      </Text>
    );
    // For URL segments, emit an OSC 8 terminal hyperlink so the terminal itself makes the
    // text clickable (Cmd/Ctrl-click). fallback={false} keeps the visible text unchanged so
    // the pre-computed line widths still hold on terminals without hyperlink support.
    return s.url
      ? <Link key={i} url={s.url} fallback={false}>{inner}</Link>
      : React.cloneElement(inner, { key: i });
  });
}

export type FeedLinesResult = {
  lines: React.ReactNode[];
  toggleAtLine: Map<number, string>;
  groupToggleAtLine: Map<number, number>;
  linkAtLine: Map<number, LineLink[]>;
  /** Line index where the most recent user message begins, or -1 if none. */
  lastUserLineStart: number;
};

export function useFeedLines(
  feed: FeedItem[],
  innerWidth: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reasoningTick: number,
  spinnerFrame: number,
  collapsedGroups: ReadonlySet<number>,
  focusedGroupKey: number | null,
  itemExpandState: ReadonlyMap<string, boolean>,
  hoveredLineIdx: number | null,
  config: SciraConfig,
): FeedLinesResult {
  const theme = useTheme();
  return useMemo(() => {
    const bandBg = theme.userBandBackground ? { backgroundColor: theme.userBandBackground } : {};
    const lines: React.ReactNode[] = [];
    const toggleAtLine = new Map<number, string>();
    const groupToggleAtLine = new Map<number, number>();
    const linkAtLine = new Map<number, LineLink[]>();
    let lastUserLineStart = -1;
    let key = 0;
    const { groupOf, groups } = computeGroups(feed);

    const eff: EffItem[] = [];
    for (let i = 0; i < feed.length; i++) {
      const gs = groupOf[i];
      if (gs !== -1) {
        const info = groups.get(gs)!;
        const collapsed = !info.active && collapsedGroups.has(gs);
        if (gs === i) {
          eff.push({ _tag: "gh", info, key: gs, collapsed, focused: focusedGroupKey === gs });
          if (!collapsed) eff.push({ _tag: "fi", idx: i, item: feed[i] });
        } else if (!collapsed) {
          eff.push({ _tag: "fi", idx: i, item: feed[i] });
        }
      } else {
        eff.push({ _tag: "fi", idx: i, item: feed[i] });
      }
    }

    eff.forEach((item, ei) => {
      const currKind = isGH(item) ? "gh" : item.item.kind;
      if (ei === 0 && currKind === "user") {
        lines.push(<Text key={key++}>{" "}</Text>);
      }
      if (ei > 0) {
        const prev = eff[ei - 1];
        const prevGH = isGH(prev);
        const currGH = isGH(item);
        const prevKind = prevGH ? "gh" : (prev as EffFeedItem).item.kind;
        const currKind = currGH ? "gh" : (item as EffFeedItem).item.kind;
        const prevTool = prevKind === "tool" || prevKind === "reasoning";
        const currTool = currKind === "tool" || currKind === "reasoning";

        if (currKind === "gh") {
          if (prevTool) {
            lines.push(<Text key={key++} color={theme.textDim}>{S_BAR}</Text>);
            lines.push(<Text key={key++}>{" "}</Text>);
          } else if (prevKind !== "gh") {
            lines.push(<Text key={key++}>{" "}</Text>);
          }
        } else if (prevKind === "gh") {
          if ((prev as GroupHeader).collapsed) {
            if (currKind !== "user") lines.push(<Text key={key++}>{" "}</Text>);
          }
        } else if (prevTool && currTool) {
          if (!(prevKind === "reasoning" && currKind === "reasoning")) {
            lines.push(<Text key={key++} color={theme.textDim}>{S_BAR}</Text>);
          }
        } else if (prevTool) {
          if (currKind !== "user") lines.push(<Text key={key++}>{" "}</Text>);
        } else if (currTool) {
          lines.push(<Text key={key++}>{" "}</Text>);
        } else if (prevKind === "status" && currKind === "status") {
        } else if (currKind === "user") {
          if (prevKind !== "user") {
            lines.push(<Text key={key++}>{" "}</Text>);
            lines.push(<Text key={key++}>{" "}</Text>);
          }
        } else {
          lines.push(<Text key={key++}>{" "}</Text>);
        }
      }

      if (isGH(item)) {
        const { info, collapsed, focused, key: groupKey } = item;
        const headerLineIdx = lines.length;
        const hovered = hoveredLineIdx === headerLineIdx;
        if (!info.active) groupToggleAtLine.set(headerLineIdx, groupKey);
        const icon = info.active ? "◎" : collapsed ? "▶" : "▼";
        const hc = focused || hovered ? theme.accent : theme.textDim;
        const labels = info.stepLabels.slice(0, 6).join(", ") + (info.stepLabels.length > 6 ? ", …" : "");
        lines.push(
          <Text key={key++} wrap="truncate">
            <Text color={info.active ? theme.accent : hc} bold={info.active || focused || hovered}>{icon} </Text>
            <Text color={info.active ? theme.text : hc} bold={info.active || focused || hovered}>
              {info.itemCount} step{info.itemCount !== 1 ? "s" : ""}
            </Text>
            {(collapsed || info.active) && labels ? (
              <Text color={theme.textDim}>{"  "}{labels}</Text>
            ) : null}
            {focused && !collapsed && !info.active ? (
              <Text color={theme.textDim}>{"  [c] collapse · [esc] unfocus"}</Text>
            ) : null}
          </Text>
        );
        return;
      }

      const fi = (item as EffFeedItem).item;
      const feedIdx = (item as EffFeedItem).idx;

      if (fi.kind === "tool") {
        const running = fi.status === "running";
        const failed = fi.status === "error";
        const itemId = feedToolItemId(feedIdx, fi.toolCallId);
        const collapsible = isCollapsibleToolName(fi.name) && !running;
        const collapsed = collapsible && isToolItemCollapsed(itemId, fi.name, fi.status, itemExpandState);
        const headerLineIdx = lines.length;
        const hovered = hoveredLineIdx === headerLineIdx;
        const toolIcon = running
          ? SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
          : TOOL_ICONS[fi.name] ?? "·";
        const symColor = failed ? theme.error : theme.accentDim;
        const nameColor = running ? theme.text : failed ? theme.error : theme.textDim;
        const panelWidth = innerWidth - 4;
        const preview = formatToolResultPreview(fi.name, fi.summary, fi.result, fi.status);
        const bodyLines = formatToolResultLines(
          fi.name, fi.summary, fi.result, fi.status, panelWidth, theme, !collapsed,
        );

        if (collapsible) toggleAtLine.set(headerLineIdx, itemId);

        lines.push(
          <Text key={key++} wrap="truncate">
            {collapsible ? (
              <Text color={hovered ? theme.accent : theme.textDim} bold={hovered}>
                {collapsed ? "▶ " : "▼ "}
              </Text>
            ) : null}
            <Text color={symColor} bold={running}>{toolIcon}</Text>
            <Text color={nameColor} bold={running || failed || hovered}> {fi.name}</Text>
            {failed ? <Text color={theme.error}> failed</Text> : null}
            {running ? <Text color={theme.textDim}> …</Text> : null}
            {!running && !failed && collapsed && preview ? (
              <Text color={theme.textDim}>  {preview}</Text>
            ) : null}
          </Text>
        );

        for (const row of bodyLines) {
          if (row.length === 0) {
            lines.push(<Text key={key++} color={theme.textDim}>{S_BAR}</Text>);
            continue;
          }
          const prefix = `${S_BAR} `;
          const lineIdx = lines.length;
          const links = computeLineLinks(row, displayWidth(prefix));
          if (links.length > 0) linkAtLine.set(lineIdx, links);
          lines.push(
            <Text key={key++} wrap="truncate-end">
              <Text color={theme.textDim}>{prefix}</Text>
              {renderSegNodes(row, theme, theme.textDim)}
            </Text>
          );
        }
      } else if (fi.kind === "user") {
        const bandW = innerWidth;
        const time = formatTime(fi.ts);
        const rightPad = time ? time.length + 1 : 0;
        const wrapped = wrapText(fi.text, Math.max(10, bandW - 4 - rightPad));
        const blank = " ".repeat(bandW);
        lastUserLineStart = lines.length;
        lines.push(<Text key={key++} {...bandBg}>{blank}</Text>);
        wrapped.forEach((l, idx) => {
          const isFirst = idx === 0;
          const prefix = isFirst ? "  ❯ " : "    ";
          const left = prefix + l;
          const pad = Math.max(1, bandW - displayWidth(left) - (isFirst ? rightPad : 0));
          lines.push(
            <Text key={key++} {...bandBg} wrap="truncate">
              <Text color={isFirst ? theme.accent : theme.text}>{prefix}</Text>
              <Text color={theme.text}>{l}</Text>
              <Text>{" ".repeat(pad)}</Text>
              {isFirst && time ? <Text color={theme.textDim}>{time + " "}</Text> : null}
            </Text>
          );
        });
        lines.push(<Text key={key++} {...bandBg}>{blank}</Text>);
      } else if (fi.kind === "status") {
        lines.push(<Text key={key++} color={theme.textDim} wrap="truncate">{"  · "}{fi.text}</Text>);
      } else if (fi.kind === "reasoning") {
        const isOpen = fi.durationMs === undefined;
        const elapsedMs = fi.durationMs ?? (fi.startedAt ? Date.now() - fi.startedAt : 0);
        const titleText = isOpen ? `Thinking… ${fmtDuration(elapsedMs)}` : `Thought for ${fmtDuration(elapsedMs)}`;
        lines.push(
          <Text key={key++} wrap="truncate-end">
            <Text color={theme.textDim}>◌ </Text>
            <Text color={theme.textDim} bold={isOpen}>{titleText}</Text>
          </Text>
        );
        for (const segLine of markdownToSegLines(fi.text, innerWidth - 4, theme)) {
          if (segLine.length === 0) {
            lines.push(<Text key={key++} color={theme.textDim}>{S_BAR}</Text>);
            continue;
          }
          const prefix = "│ ";
          const lineIdx = lines.length;
          const links = computeLineLinks(segLine, displayWidth(prefix));
          if (links.length > 0) linkAtLine.set(lineIdx, links);
          lines.push(
            <Text key={key++} color={theme.textDim} italic wrap="truncate-end">
              <Text color={theme.textDim}>{prefix}</Text>
              {renderSegNodes(segLine, theme, theme.textDim)}
            </Text>
          );
        }
      } else {
        for (const segLine of markdownToSegLines(fi.text, innerWidth - 2, theme)) {
          if (segLine.length === 0) { lines.push(<Text key={key++}>{" "}</Text>); continue; }
          const lineIdx = lines.length;
          const links = computeLineLinks(segLine, 0);
          if (links.length > 0) linkAtLine.set(lineIdx, links);
          lines.push(
            <Text key={key++} wrap="truncate-end">
              {renderSegNodes(segLine, theme, theme.text)}
            </Text>
          );
        }
      }
    });

    return { lines, toggleAtLine, groupToggleAtLine, linkAtLine, lastUserLineStart };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, innerWidth, reasoningTick, spinnerFrame, collapsedGroups, focusedGroupKey, itemExpandState, hoveredLineIdx, config, theme]);
}
