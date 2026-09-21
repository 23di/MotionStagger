import { isBezierPoints } from "./easing";
import type { StaggerSettings } from "./types";

const orders = ["selection", "top-bottom", "bottom-top", "left-right", "right-left", "align-start", "align-end", "center-out", "edges-in", "random"] as const;
const easings = ["preserve", "CUSTOM_CUBIC_BEZIER", "LINEAR", "EASE_IN", "EASE_OUT", "EASE_IN_AND_OUT", "EASE_IN_BACK", "EASE_OUT_BACK", "EASE_IN_AND_OUT_BACK", "GENTLE", "QUICK", "BOUNCY", "SLOW", "HOLD"] as const;
const keys = new Set(["operation", "staggerBy", "groupLevel", "order", "distribution", "distributionBezier", "spanMs", "startOffsetMs", "anchor", "alignment", "trackScope", "keyframeEasing", "customBezier", "randomSeed"]);

function choice<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`Invalid ${name} in settings JSON.`);
  return value as T;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${name} in settings JSON.`);
  return value;
}

export function parseStaggerSettingsJson(text: string): StaggerSettings {
  if (text.length > 50_000) throw new Error("Settings JSON is too large.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Paste valid settings JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Paste a JSON object with stagger settings.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !keys.has(key))) throw new Error("Settings JSON contains an unknown field.");
  if (input.operation !== undefined && input.operation !== "stagger") throw new Error("Only stagger settings can be pasted here.");
  if (input.alignment !== "preserve") throw new Error("Invalid alignment in settings JSON.");
  const staggerBy = choice(input.staggerBy, ["tracks", "layers", "groups", "keyframes"] as const, "stagger mode");
  let order = choice(input.order, orders, "order");
  if (staggerBy === "tracks") {
    if (order === "left-right") order = "align-start";
    if (order === "right-left") order = "align-end";
  } else {
    if (order === "align-start") order = "left-right";
    if (order === "align-end") order = "right-left";
  }
  const distribution = choice(input.distribution, ["linear", "ease-in", "ease-out", "ease-in-out", "custom"] as const, "stagger easing");
  const keyframeEasing = choice(input.keyframeEasing, easings, "keyframe easing");
  const distributionBezier = input.distributionBezier;
  const customBezier = input.customBezier;
  if (distributionBezier !== undefined && !isBezierPoints(distributionBezier) ||
      customBezier !== undefined && !isBezierPoints(customBezier) ||
      distribution === "custom" && !isBezierPoints(distributionBezier) ||
      keyframeEasing === "CUSTOM_CUBIC_BEZIER" && !isBezierPoints(customBezier)) {
    throw new Error("Invalid Bézier curve in settings JSON.");
  }
  const spanMs = finite(input.spanMs, "Span");
  const startOffsetMs = finite(input.startOffsetMs, "start offset");
  if (startOffsetMs < -3000 || startOffsetMs > 3000) throw new Error("Start offset must be between −3000 and 3000 ms.");
  const randomSeed = finite(input.randomSeed, "random seed");
  if (!Number.isInteger(randomSeed)) throw new Error("Random seed must be an integer.");
  return {
    operation: "stagger", staggerBy,
    groupLevel: choice(input.groupLevel, ["immediate", "top-level"] as const, "group level"),
    order, distribution, distributionBezier: distributionBezier as StaggerSettings["distributionBezier"],
    spanMs, startOffsetMs,
    anchor: choice(input.anchor, ["relative", "playhead", "start"] as const, "anchor"),
    alignment: "preserve",
    trackScope: choice(input.trackScope, ["all", "position", "transform", "appearance", "layout"] as const, "track scope"),
    keyframeEasing, customBezier: customBezier as StaggerSettings["customBezier"], randomSeed,
  };
}

export function stringifyStaggerSettings(settings: StaggerSettings): string {
  return JSON.stringify(settings, null, 2);
}
