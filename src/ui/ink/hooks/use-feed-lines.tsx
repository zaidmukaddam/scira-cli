import React, { useMemo } from "react";
import { Text } from "ink";
import { type FeedItem } from "../types.js";
import { S_BAR, TOOL_ICONS, USER_BAND_BG, SPINNER_FRAMES } from "../constants.js";
import { formatTime, fmtDuration, wrapText, hyperlink, displayWidth } from "../lib/utils.js";
import { markdownToSegLines } from "../lib/markdown.js";

export type GroupInfo = { toolNames: string[]; itemCount: number; active: boolean; end: number };

export function computeGroups(feed: FeedItem[]): { groupOf: number[]; groups: Map<number, GroupInfo> } {
  const groupOf = new Array<number>(feed.length).fill(-1);
  const groups = new Map<number, GroupInfo>();
  let gs = -1;
  for (let i = 0; i < feed.length; i++) {
    const k = feed[i].kind;
    if (k === "tool" || k === "reasoning") {
      if (gs === -1) { gs = i; groups.set(gs, { toolNames: [], itemCount: 0, active: false, end: i }); }
      const g = groups.get(gs)!;
      g.end = i;
      g.itemCount++;
      groupOf[i] = gs;
      if (k === "tool") {
        const it = feed[i] as Extract<FeedItem, { kind: "tool" }>;
        if (!g.toolNames.includes(it.name)) g.toolNames.push(it.name);
        if (it.status === "running") g.active = true;
      } else {
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
type EffItem = FeedItem | GroupHeader;
const isGH = (item: EffItem): item is GroupHeader => "_tag" in item;

export function useFeedLines(
  feed: FeedItem[],
  innerWidth: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reasoningTick: number,
  spinnerFrame: number,
  collapsedGroups: ReadonlySet<number>,
  focusedGroupKey: number | null,
): React.ReactNode[] {
  return useMemo(() => {
    const lines: React.ReactNode[] = [];
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
          if (!collapsed) eff.push(feed[i]);
        } else if (!collapsed) {
          eff.push(feed[i]);
        }
      } else {
        eff.push(feed[i]);
      }
    }

    eff.forEach((item, ei) => {
      const currKind = isGH(item) ? "gh" : (item as FeedItem).kind;
      if (ei === 0 && currKind === "user") {
        lines.push(<Text key={key++}>{" "}</Text>);
      }
      if (ei > 0) {
        const prev = eff[ei - 1];
        const prevGH = isGH(prev);
        const currGH = isGH(item);
        const prevKind = prevGH ? "gh" : (prev as FeedItem).kind;
        const currKind = currGH ? "gh" : (item as FeedItem).kind;
        const prevTool = prevKind === "tool" || prevKind === "reasoning";
        const currTool = currKind === "tool" || currKind === "reasoning";

        if (currKind === "gh") {
          if (prevTool) {
            lines.push(<Text key={key++} color="gray" dimColor>{S_BAR}</Text>);
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
            lines.push(<Text key={key++} color="gray" dimColor>{S_BAR}</Text>);
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
        const { info, collapsed, focused } = item;
        const icon = info.active ? "◎" : collapsed ? "▶" : "▼";
        const hc = focused ? "#FFE0C2" : "gray";
        const names = info.toolNames.slice(0, 5).join(", ") + (info.toolNames.length > 5 ? ", …" : "");
        lines.push(
          <Text key={key++} wrap="truncate">
            <Text color={info.active ? "#FFE0C2" : hc} bold={info.active || focused}>{icon} </Text>
            <Text color={info.active ? "white" : hc} bold={info.active || focused} dimColor={!info.active && !focused}>
              {info.itemCount} step{info.itemCount !== 1 ? "s" : ""}
            </Text>
            {(collapsed || info.active) && names ? (
              <Text color="gray" dimColor>{"  "}{names}</Text>
            ) : null}
            {focused && !collapsed && !info.active ? (
              <Text color="gray" dimColor>{"  [c] collapse · [esc] unfocus"}</Text>
            ) : null}
          </Text>
        );
        return;
      }

      const fi = item as FeedItem;

      if (fi.kind === "tool") {
        const toolIcon = fi.status === "running"
          ? SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
          : TOOL_ICONS[fi.name] ?? "·";
        const symColor = "#CFB59D";
        const nameColor = fi.status === "running" ? "white" : "gray";
        const summaryLine = fi.summary.replace(/\s+/gu, " ").trim();
        const toolSummary = summaryLine.length > innerWidth - fi.name.length - 6
          ? summaryLine.slice(0, Math.max(0, innerWidth - fi.name.length - 7)) + "…"
          : summaryLine;
        lines.push(
          <Text key={key++} wrap="truncate">
            <Text color={symColor} bold={fi.status === "running"}>{toolIcon}</Text>
            <Text color={nameColor} bold={fi.status === "running"} dimColor={fi.status === "done"}> {fi.name}</Text>
            <Text color="gray" dimColor>  {toolSummary}</Text>
          </Text>
        );
      } else if (fi.kind === "user") {
        const bandW = innerWidth;
        const time = formatTime(fi.ts);
        const rightPad = time ? time.length + 1 : 0;
        const wrapped = wrapText(fi.text, Math.max(10, bandW - 4 - rightPad));
        const blank = " ".repeat(bandW);
        lines.push(<Text key={key++} backgroundColor={USER_BAND_BG}>{blank}</Text>);
        wrapped.forEach((l, idx) => {
          const isFirst = idx === 0;
          const prefix = isFirst ? "  ❯ " : "    ";
          const left = prefix + l;
          const pad = Math.max(1, bandW - displayWidth(left) - (isFirst ? rightPad : 0));
          lines.push(
            <Text key={key++} backgroundColor={USER_BAND_BG} wrap="truncate">
              <Text color={isFirst ? "#FFE0C2" : "white"}>{prefix}</Text>
              <Text color="white">{l}</Text>
              <Text>{" ".repeat(pad)}</Text>
              {isFirst && time ? <Text color="gray" dimColor>{time + " "}</Text> : null}
            </Text>
          );
        });
        lines.push(<Text key={key++} backgroundColor={USER_BAND_BG}>{blank}</Text>);
      } else if (fi.kind === "status") {
        lines.push(<Text key={key++} color="gray" dimColor wrap="truncate">{"  · "}{fi.text}</Text>);
      } else if (fi.kind === "reasoning") {
        const isOpen = fi.durationMs === undefined;
        const elapsedMs = fi.durationMs ?? (fi.startedAt ? Date.now() - fi.startedAt : 0);
        const titleText = isOpen ? `Thinking… ${fmtDuration(elapsedMs)}` : `Thought for ${fmtDuration(elapsedMs)}`;
        lines.push(
          <Text key={key++} wrap="truncate-end">
            <Text color="gray" dimColor>◌ </Text>
            <Text color="gray" bold={isOpen} dimColor={!isOpen}>{titleText}</Text>
          </Text>
        );
        for (const segLine of markdownToSegLines(fi.text, innerWidth - 4)) {
          if (segLine.length === 0) {
            lines.push(<Text key={key++} color="gray" dimColor>{S_BAR}</Text>);
            continue;
          }
          lines.push(
            <Text key={key++} color="gray" dimColor italic wrap="truncate-end">
              <Text color="gray" dimColor>{"│ "}</Text>
              {segLine.map((s, i) => (
                <Text key={i} color="gray" bold={s.bold} italic={s.italic ?? true} underline={s.underline} dimColor>{hyperlink(s.text, s.url)}</Text>
              ))}
            </Text>
          );
        }
      } else {
        for (const segLine of markdownToSegLines(fi.text, innerWidth - 2)) {
          if (segLine.length === 0) { lines.push(<Text key={key++}>{" "}</Text>); continue; }
          lines.push(
            <Text key={key++} wrap="truncate-end">
              {segLine.map((s, i) => (
                <Text key={i} color={s.color ?? "white"} bold={s.bold} italic={s.italic} underline={s.underline} dimColor={s.dim}>{hyperlink(s.text, s.url)}</Text>
              ))}
            </Text>
          );
        }
      }
    });

    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, innerWidth, reasoningTick, spinnerFrame, collapsedGroups, focusedGroupKey]);
}
