import { evaluateBezier } from "./easing";
import type { MotionPreviewTrack } from "./types";

export function samplePreviewTrack(track: MotionPreviewTrack | undefined, time: number, fallback: number): number {
  if (!track) return fallback;
  const frames = track.keyframes;
  if (!frames.length) return track.baseValue;
  if (time <= frames[0].time) return frames[0].value;
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1];
    const next = frames[i];
    if (time >= next.time) continue;
    const progress = Math.max(0, Math.min(1, (time - previous.time) / Math.max(0.0001, next.time - previous.time)));
    let eased = progress;
    if (next.easing === "HOLD") eased = 0;
    else if (next.bezier) eased = evaluateBezier(progress, next.bezier);
    else if (next.easing === "EASE_IN") eased = progress * progress;
    else if (next.easing === "EASE_OUT") eased = 1 - (1 - progress) ** 2;
    else if (next.easing === "EASE_IN_AND_OUT") eased = progress * progress * (3 - 2 * progress);
    return previous.value + (next.value - previous.value) * eased;
  }
  return frames[frames.length - 1].value;
}
