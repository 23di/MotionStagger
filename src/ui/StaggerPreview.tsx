import { useEffect, useRef, useState } from "react";
import { samplePreviewTrack as sample } from "../shared/preview-motion";
import { ActionButton } from "./DialControls";
import type { MotionPreviewNode, MotionPreviewTrack, SelectionSummary } from "../shared/types";

export interface PreviewEmptyState {
  title: string;
  description: string;
  action?: { label: string; disabled?: boolean; onClick: () => void };
}

export function StaggerPreview({ nodes, playheadMs = 0, frame: sourceFrame, emptyState, expand = false }: {
  nodes: MotionPreviewNode[]; playheadMs?: number; frame?: SelectionSummary["motionPreviewFrame"];
  emptyState?: PreviewEmptyState; expand?: boolean;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(328);
  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const resize = () => setPreviewWidth(element.clientWidth);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const [time, setTime] = useState(0);
  const duration = Math.max(0, ...nodes.flatMap(node => node.tracks.flatMap(track => track.keyframes.map(frame => frame.time))));
  useEffect(() => {
    if (emptyState || !duration || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let started = 0;
    const tick = (now: number) => {
      if (!started) started = now;
      setTime(((now - started) / 1000) % duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, nodes.map(node => node.id).join("|"), Boolean(emptyState)]);
  const visible = nodes.filter(node => node.tracks.length);
  const showAnimation = !emptyState && visible.length > 0;
  const capturedAt = playheadMs / 1000;
  const minX = visible.length ? Math.min(...visible.map(node => node.x)) : 0;
  const minY = visible.length ? Math.min(...visible.map(node => node.y)) : 0;
  const maxX = visible.length ? Math.max(...visible.map(node => node.x + node.width)) : 1;
  const maxY = visible.length ? Math.max(...visible.map(node => node.y + node.height)) : 1;
  const bounds = sourceFrame?.width && sourceFrame?.height ? sourceFrame :
    { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  const height = showAnimation ? sourceFrame ? Math.min(240, previewWidth * bounds.height / bounds.width) : 180 : 200;
  const scale = Math.min(previewWidth / bounds.width, height / bounds.height);
  const offsetX = (previewWidth - bounds.width * scale) / 2;
  const offsetY = (height - bounds.height * scale) / 2;
  const fallbackEmpty: PreviewEmptyState = nodes.length
    ? { title: "Preview unavailable", description: "Select layers with manual position, scale, rotation, or opacity tracks." }
    : { title: "Nothing selected", description: "Select an animated frame or layers in Figma to see a preview." };
  const empty = emptyState ?? fallbackEmpty;
  return <div ref={previewRef} className={`stagger-preview${expand ? " expanded" : ""}`} style={{ height: expand ? undefined : height }} role={showAnimation ? "img" : "region"}
    aria-label={showAnimation ? "Preview of selected manual Motion keyframes" : empty.title}>
    <div className="stagger-preview-grid" aria-hidden="true" />
    {showAnimation && sourceFrame?.backgroundSvg && <img className="stagger-preview-background" alt="" aria-hidden="true"
      src={`data:image/svg+xml,${encodeURIComponent(sourceFrame.backgroundSvg)}`}
      style={{ left: offsetX, top: offsetY, width: bounds.width * scale, height: bounds.height * scale }} />}
    {showAnimation ? visible.map((node) => {
      const track = (field: MotionPreviewTrack["field"]) => node.tracks.find(item => item.field === field);
      const x = sample(track("TRANSLATION_X"), time, 0) - sample(track("TRANSLATION_X"), capturedAt, 0);
      const y = sample(track("TRANSLATION_Y"), time, 0) - sample(track("TRANSLATION_Y"), capturedAt, 0);
      const rotation = sample(track("ROTATION"), time, 0) - sample(track("ROTATION"), capturedAt, 0);
      const scaleX = sample(track("SCALE_X"), time, 1) / (sample(track("SCALE_X"), capturedAt, 1) || 1);
      const scaleY = sample(track("SCALE_Y"), time, 1) / (sample(track("SCALE_Y"), capturedAt, 1) || 1);
      // Static export can contain complete artwork even when the first motion
      // key is transparent. Never discard it based on a sampled motion value.
      const useImage = Boolean(node.imageDataUrl);
      const opacity = sample(track("OPACITY"), time, node.artworkOpacity ?? 1)
        / (useImage ? node.artworkOpacity || 1 : 1);
      const left = offsetX + (node.x + node.width / 2 - bounds.x) * scale;
      const top = offsetY + (node.y + node.height / 2 - bounds.y) * scale;
      return <div className="stagger-preview-position" key={node.id} style={{ left, top }}>
        <div className={`stagger-preview-card${useImage ? " has-image" : ""}`} title={node.name} style={{
          width: Math.max(1, node.width * scale),
          height: Math.max(1, node.height * scale),
          background: "transparent",
          opacity: Math.max(0, Math.min(1, opacity)),
          transform: `translate(${x * scale}px, ${y * scale}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
        }}>{useImage ? <img className="stagger-preview-image" src={node.imageDataUrl} alt="" /> : null}</div>
      </div>;
    }) : <div className="stagger-preview-empty">
      <strong>{empty.title}</strong>
      <p>{empty.description}</p>
      {empty.action && <ActionButton label={empty.action.label} disabled={empty.action.disabled} onClick={empty.action.onClick} />}
    </div>}
  </div>;
}
