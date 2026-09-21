import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { SelectionSummary } from "../shared/types";

const TRACK_COLORS = ["#ff6534", "#c4ff48", "#559eff", "#bd78f0", "#e6cc72"];

export function TrackTimeline({ preview, theme }: { preview: SelectionSummary["timingPreview"]; theme: "light" | "dark" | "system" }) {
  const [preferredHeight, setPreferredHeight] = useState<number | null>(() => {
    try {
      const stored = Number(localStorage.getItem("cascade-shifter-preview-height"));
      return Number.isFinite(stored) && stored >= 60 && stored <= 420 ? stored : null;
    } catch { return null; }
  });
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const tooltipId = useId();
  const [hover, setHover] = useState<{ id: string; x: number; y: number; below: boolean } | null>(null);
  const showTooltip = (id: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const below = rect.top < 86;
    setHover({ id, x: Math.max(130, Math.min(window.innerWidth - 130, rect.left + rect.width / 2)),
      y: below ? rect.bottom + 8 : rect.top - 8, below });
  };
  useEffect(() => {
    const clear = () => setHover(null);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => { window.removeEventListener("scroll", clear, true); window.removeEventListener("resize", clear); };
  }, []);
  useEffect(() => { setHover(null); }, [preview]);
  const maximumHeight = 420;
  const height = preferredHeight ?? 148;
  const resize = (next: number) => {
    const value = Math.round(Math.max(60, Math.min(maximumHeight, next)));
    setPreferredHeight(value);
    try { localStorage.setItem("cascade-shifter-preview-height", String(value)); } catch { /* Optional persistence. */ }
  };
  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const tracks = preview?.tracks ?? [];
  if (!tracks.length) return null;
  let end = 1;
  for (const track of tracks) end = Math.max(end, track.originalEnd, track.times[track.times.length - 1]);
  const duration = preview?.duration && preview.duration > 0 ? preview.duration : Math.ceil(end * 2) / 2;
  const position = (time: number) => `${Math.max(0, Math.min(100, time / duration * 100))}%`;
  const hoveredTrack = tracks.find(track => track.id === hover?.id);
  return <><section className="track-timeline" aria-label="Layer timing preview">
      <div className="timeline-ruler" aria-label="Time scale in seconds">
        <div className="timeline-ruler-labels"><span>0</span><span>{Number((duration / 2).toFixed(2))} s</span><span>{Number(duration.toFixed(2))} s</span></div>
      </div>
      <div className="timeline-tracks" style={{ "--track-count": tracks.length, "--preview-height": `${height}px` } as CSSProperties} role="list" aria-label="Manual track timing">
        {tracks.map((track, index) => {
          const start = track.times[0], finish = track.times[track.times.length - 1];
          const label = track.nodeName;
          const shift = start - track.originalStart;
          const tooltip = `${label}\nLength: ${(finish - start).toFixed(2)} s\nShift: ${shift > 0 ? "+" : ""}${shift.toFixed(2)} s`;
          return <div className="timeline-row" key={track.id} role="listitem" aria-label={tooltip}>
            <div className="timeline-lane">
              <span className="timeline-bar" tabIndex={0}
                aria-label={tooltip} aria-describedby={hover?.id === track.id ? tooltipId : undefined}
                onMouseEnter={event => showTooltip(track.id, event.currentTarget)} onMouseLeave={() => setHover(null)}
                onFocus={event => showTooltip(track.id, event.currentTarget)} onBlur={() => setHover(null)}
                onKeyDown={event => { if (event.key === "Escape") setHover(null); }}
                style={{ left: position(start), width: position(finish - start), background: TRACK_COLORS[index % TRACK_COLORS.length] }} />
            </div>
          </div>;
        })}
      </div>
      <div className={`timeline-resize${dragging ? " dragging" : ""}`} role="separator" tabIndex={0}
        aria-label="Resize preview height" aria-orientation="horizontal" aria-valuemin={60} aria-valuemax={maximumHeight} aria-valuenow={height}
        title="Drag to resize preview · Arrow keys change height · Double-click to reset height"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, y: event.clientY, height };
          setDragging(true);
        }}
        onPointerMove={event => {
          if (drag.current?.pointerId === event.pointerId) resize(drag.current.height + event.clientY - drag.current.y);
        }}
        onPointerUp={stopDragging} onPointerCancel={stopDragging} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onDoubleClick={() => {
          setPreferredHeight(null);
          try { localStorage.removeItem("cascade-shifter-preview-height"); } catch { /* Optional persistence. */ }
        }}
        onKeyDown={event => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          resize(height + (event.key === "ArrowDown" ? 10 : -10));
        }}><span /></div>
      {preview?.truncated && <p className="timeline-caption">Selection partially shown</p>}
  </section>
  {hover && hoveredTrack && createPortal(<div id={tooltipId} role="tooltip"
    className={`order-tooltip timeline-tooltip dialkit-root${hover.below ? " below" : ""}`} data-theme={theme}
    style={{ left: hover.x, top: hover.y }}>
    <strong>{hoveredTrack.nodeName}</strong>
    <span>Length: {(hoveredTrack.times[1] - hoveredTrack.times[0]).toFixed(2)} s</span>
    <span>Shift: {hoveredTrack.times[0] > hoveredTrack.originalStart ? "+" : ""}{(hoveredTrack.times[0] - hoveredTrack.originalStart).toFixed(2)} s</span>
  </div>, document.body)}
  </>;
}
