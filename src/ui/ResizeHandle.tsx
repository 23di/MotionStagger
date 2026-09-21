import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { PLUGIN_UI } from "../shared/ui";
import type { UiToPluginMessage } from "../shared/messages";

const windowHeightKey = "cascade-shifter-window-height";
const minWindowHeight = PLUGIN_UI.minHeight;
const maxWindowHeight = PLUGIN_UI.maxHeight;

function readSavedWindowHeight(): number | null {
  try {
    const saved = Number(window.localStorage.getItem(windowHeightKey));
    return Number.isFinite(saved) && saved >= minWindowHeight && saved <= maxWindowHeight
      ? saved
      : null;
  } catch {
    return null;
  }
}

function saveWindowHeight(height: number): void {
  try {
    window.localStorage.setItem(windowHeightKey, String(height));
  } catch {
    // Figma may disable storage for a sandboxed plugin UI. Resizing still works.
  }
}

export function ResizeHandle() {
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState(() => window.innerHeight);
  const dragStart = useRef({ screenY: 0, height: window.innerHeight });
  const pendingFrame = useRef(0);
  const pendingHeight = useRef(window.innerHeight);

  const resize = useCallback((nextHeight: number) => {
    const clamped = Math.round(
      Math.min(maxWindowHeight, Math.max(minWindowHeight, nextHeight)),
    );
    setHeight(clamped);
    pendingHeight.current = clamped;
    saveWindowHeight(clamped);

    if (pendingFrame.current) return;
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = 0;
      parent.postMessage({ pluginMessage: { type: "resize-ui", width: PLUGIN_UI.width, height: pendingHeight.current } satisfies UiToPluginMessage }, "*");
    });
  }, []);

  useEffect(() => {
    const saved = readSavedWindowHeight();
    if (saved !== null) resize(saved);
    return () => {
      if (pendingFrame.current) cancelAnimationFrame(pendingFrame.current);
    };
  }, [resize]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { screenY: event.screenY, height: window.innerHeight };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    resize(dragStart.current.height + event.screenY - dragStart.current.screenY);
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    resize(height + (event.key === "ArrowDown" ? 40 : -40));
  };

  return (
    <div
      className={`resize-handle ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-label="Resize plugin height"
      aria-orientation="horizontal"
      aria-valuemin={minWindowHeight}
      aria-valuemax={maxWindowHeight}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize · Arrow keys change height"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={() => setDragging(false)}
      onKeyDown={onKeyDown}
    >
      <span className="resize-grip" />
    </div>
  );
}
