import React, { useCallback, useRef, useState } from "react";

export function useMouse(onWheel?: (dir: 1 | -1) => void): {
  clickMapRef: React.RefObject<Map<number, () => void>>;
  hoverMapRef: React.RefObject<Map<number, number>>;
  hoveredIdx: number | null;
  setHoveredIdx: React.Dispatch<React.SetStateAction<number | null>>;
  handleMouseData: (data: Buffer) => void;
} {
  const clickMapRef = useRef<Map<number, () => void>>(new Map());
  const hoverMapRef = useRef<Map<number, number>>(new Map());
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;

  const handleMouseData = useCallback((data: Buffer) => {
    const s = data.toString("utf8");
    const m = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/u.exec(s);
    if (!m) return;
    const code = Number(m[1]);
    const y = Number(m[3]);
    if ((code & 64) !== 0) { // wheel event: 64 = up, 65 = down (modifier bits 4/8/16 may be set)
      onWheelRef.current?.((code & 1) === 0 ? 1 : -1);
      return;
    }
    if ((code & 32) !== 0) { // motion event → hover
      const idx = hoverMapRef.current.get(y);
      setHoveredIdx(idx ?? null);
      return;
    }
    if (m[4] !== "M" || (code & 3) !== 0) return; // left button press only
    const action = clickMapRef.current.get(y);
    if (action) action();
  }, []);

  return { clickMapRef, hoverMapRef, hoveredIdx, setHoveredIdx, handleMouseData };
}
