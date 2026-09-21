export type BezierPoints = [number, number, number, number];

export const DEFAULT_BEZIER: BezierPoints = [0.25, 0.1, 0.25, 1];

export function isBezierPoints(value: unknown): value is BezierPoints {
  return Array.isArray(value) && value.length === 4 &&
    value.every((point) => typeof point === "number" && Number.isFinite(point)) &&
    value[0] >= 0 && value[0] <= 1 && value[2] >= 0 && value[2] <= 1;
}

// Progress is X, not the Bézier parameter. Invert X before evaluating Y.
export function evaluateBezier(progress: number, [x1, y1, x2, y2]: BezierPoints): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const sample = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const t = (low + high) / 2;
    if (sample(t, x1, x2) < progress) low = t;
    else high = t;
  }
  return sample((low + high) / 2, y1, y2);
}
