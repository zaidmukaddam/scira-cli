import React from "react";
import { HOME_TIPS, SPINNER_FRAMES } from "../constants.js";

/** Stable mount-only effect: makes intent explicit, prevents accidental dep-driven re-runs. */
export function useMountEffect(effect: React.EffectCallback): void {
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  React.useEffect(effect, []);
}

/** Cycles the tip index every 6 s while mounted (rendered only on the home screen). */
export function TipCycler({ setTipIndex }: { setTipIndex: React.Dispatch<React.SetStateAction<number>> }): null {
  useMountEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % HOME_TIPS.length), 6000);
    return () => clearInterval(id);
  });
  return null;
}

/** Drives the spinner, caret-blink, and reasoning-clock animations while mounted (rendered only when busy). */
export function AnimationTick({
  setBlink,
  setFrame,
  setReasoningTick,
}: {
  setBlink: React.Dispatch<React.SetStateAction<boolean>>;
  setFrame: React.Dispatch<React.SetStateAction<number>>;
  setReasoningTick: React.Dispatch<React.SetStateAction<number>>;
}): null {
  useMountEffect(() => {
    const blinkId = setInterval(() => setBlink((v) => !v), 400);
    const frameId = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    const tickId = setInterval(() => setReasoningTick((t) => t + 1), 500);
    return () => {
      clearInterval(blinkId);
      clearInterval(frameId);
      clearInterval(tickId);
      setBlink(true);
      setFrame(0);
    };
  });
  return null;
}

/** Enables SGR mouse-click/hover tracking while mounted (rendered only on the home screen). */
export function MouseTracker({
  stdout,
  stdin,
  onData,
  onUnmount,
}: {
  stdout: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  onData: (data: Buffer) => void;
  onUnmount: () => void;
}): null {
  useMountEffect(() => {
    stdout.write("\x1b[?1003h\x1b[?1006h");
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      onUnmount();
      stdout.write("\x1b[?1003l\x1b[?1006l");
    };
  });
  return null;
}
