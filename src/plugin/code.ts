declare const __html__: string;

import { convertPresetSelection } from "./conversion";

import type { PluginToUiMessage, UiToPluginMessage } from "../shared/messages";
import { PLUGIN_UI } from "../shared/ui";
import { evaluateBezier, isBezierPoints } from "../shared/easing";
import { PRESET_EDIT_UNSUPPORTED } from "../shared/types";
import type {
  DistributionEasing,
  MotionPreviewNode,
  MotionPreviewTrack,
  SelectionSummary,
  TimingPreviewTrack,
  StaggerOrder,
  StaggerSettings,
  TrackScope,
} from "../shared/types";

type MotionNode = SceneNode & {
  readonly manualKeyframeTracks: ManualKeyframeTracks;
  readonly animationStyles: ReadonlyArray<AppliedAnimationStyle>;
  readonly timelines: ReadonlyArray<Timeline>;
  applyManualKeyframeTrack(field: KeyframeField, track: ManualKeyframeTrackInput): void;
  removeManualKeyframeTrack(field: KeyframeField): void;
  setTimelineDuration(id: string, duration: number): void;
};

interface TrackSnapshot {
  field: KeyframeField;
  binding: ManualKeyframeBinding;
}

interface NodeSnapshot {
  node: MotionNode;
  id: string;
  name: string;
  type: string;
  selectionIndex: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  immediateGroupId: string;
  topGroupId: string;
  tracks: TrackSnapshot[];
  timelines: Array<{ id: string; duration: number }>;
}

interface SessionSnapshot {
  nodes: NodeSnapshot[];
}

interface StaggerResult {
  changedNodes: number;
  changedTracks: number;
  changedStyles: number;
  unitCount: number;
  resolvedMode: StaggerSettings["staggerBy"] | "easing";
}

const PROPERTY_FIELDS = new Set<string>([
  "CORNER_RADIUS", "STROKE_WEIGHT", "STACK_SPACING", "STACK_PADDING_LEFT",
  "STACK_PADDING_TOP", "STACK_PADDING_RIGHT", "STACK_PADDING_BOTTOM", "WIDTH",
  "HEIGHT", "RECTANGLE_TOP_LEFT_CORNER_RADIUS", "RECTANGLE_TOP_RIGHT_CORNER_RADIUS",
  "RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS", "RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS",
  "BORDER_TOP_WEIGHT", "BORDER_BOTTOM_WEIGHT", "BORDER_LEFT_WEIGHT", "BORDER_RIGHT_WEIGHT",
  "STACK_COUNTER_SPACING", "OPACITY", "GRID_ROW_GAP", "GRID_COLUMN_GAP",
  "TRANSLATION_X", "TRANSLATION_Y", "TRANSLATION_XY", "ROTATION", "SCALE_X",
  "SCALE_Y", "SCALE_XY", "PATH_TRIM_START", "PATH_TRIM_END",
]);
const POSITION_FIELDS = new Set(["TRANSLATION_X", "TRANSLATION_Y", "TRANSLATION_XY"]);
const TRANSFORM_FIELDS = new Set([
  ...POSITION_FIELDS, "ROTATION", "SCALE_X", "SCALE_Y", "SCALE_XY",
]);
const APPEARANCE_FIELDS = new Set(["OPACITY", "PATH_TRIM_START", "PATH_TRIM_END"]);

figma.skipInvisibleInstanceChildren = true;
figma.showUI(__html__, { width: PLUGIN_UI.width, height: PLUGIN_UI.initialHeight, themeColors: true });

let workingBaseline: SessionSnapshot | null = null;
// Current committed state, separate from the session-original calculation baseline.
let cancellationBaseline: SessionSnapshot | null = null;
const originalNodes = new Map<string, NodeSnapshot>();
const hierarchyByNode = new Map<string, { immediateGroupId: string; topGroupId: string }>();
let livePreviewActive = false;
let lastPreview: { settings: string; stats: StaggerResult } | null = null;
const previewImages = new Map<string, string>();

function post(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMotionNode(node: BaseNode | null): node is MotionNode {
  return Boolean(
    node &&
      node.type !== "DOCUMENT" &&
      node.type !== "PAGE" &&
      "manualKeyframeTracks" in node &&
      "applyManualKeyframeTrack" in node,
  );
}

function isBinding(value: unknown): value is ManualKeyframeBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { keyframes?: unknown; baseValue?: unknown };
  return Array.isArray(candidate.keyframes) && candidate.baseValue !== undefined;
}

function countTracks(tracks: ManualKeyframeTracks): number {
  const source = tracks as unknown as Record<string, unknown>;
  let count = 0;
  for (const [name, value] of Object.entries(source)) {
    if (PROPERTY_FIELDS.has(name) && isBinding(value)) {
      count += 1;
      continue;
    }
    if ((name === "fills" || name === "strokes") && value && typeof value === "object") {
      for (const paintValue of Object.values(value as Record<string, unknown>)) {
        if (isBinding(paintValue)) {
          count += 1;
          continue;
        }
        const properties = (paintValue as { properties?: Record<string, unknown> })?.properties;
        if (properties) count += Object.values(properties).filter(isBinding).length;
      }
      continue;
    }
    if (name === "effects" && value && typeof value === "object") {
      for (const effectValue of Object.values(value as Record<string, unknown>)) {
        if (!effectValue || typeof effectValue !== "object") continue;
        for (const [fieldName, binding] of Object.entries(effectValue as Record<string, unknown>)) {
          if (fieldName === "properties") {
            count += Object.values((binding ?? {}) as Record<string, unknown>).filter(isBinding).length;
          } else if (isBinding(binding)) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}

function collectTracks(tracks: ManualKeyframeTracks): TrackSnapshot[] {
  const source = tracks as unknown as Record<string, unknown>;
  const result: TrackSnapshot[] = [];

  for (const [name, value] of Object.entries(source)) {
    if (PROPERTY_FIELDS.has(name) && isBinding(value)) {
      result.push({
        field: { type: "PROPERTY", name: name as KeyframePropertyFieldName },
        binding: clone(value),
      });
      continue;
    }

    if ((name === "fills" || name === "strokes") && value && typeof value === "object") {
      for (const [indexText, paintValue] of Object.entries(value as Record<string, unknown>)) {
        const index = Number(indexText);
        if (isBinding(paintValue)) {
          result.push({
            field: { type: "INDEXED_ITEM", collection: name, index },
            binding: clone(paintValue),
          });
          continue;
        }
        const properties = (paintValue as { properties?: Record<string, unknown> })?.properties;
        if (properties) {
          for (const [propertyId, binding] of Object.entries(properties)) {
            if (isBinding(binding)) {
              result.push({
                field: { type: "INDEXED_ITEM", collection: name, index, propertyId },
                binding: clone(binding),
              });
            }
          }
        }
      }
      continue;
    }

    if (name === "effects" && value && typeof value === "object") {
      for (const [indexText, effectValue] of Object.entries(value as Record<string, unknown>)) {
        const index = Number(indexText);
        if (!effectValue || typeof effectValue !== "object") continue;
        const effect = effectValue as Record<string, unknown>;
        for (const [fieldName, binding] of Object.entries(effect)) {
          if (fieldName === "properties") {
            for (const [propertyId, propertyBinding] of Object.entries(
              (binding ?? {}) as Record<string, unknown>,
            )) {
              if (isBinding(propertyBinding)) {
                result.push({
                  field: { type: "INDEXED_ITEM", collection: "effects", index, propertyId },
                  binding: clone(propertyBinding),
                });
              }
            }
          } else if (isBinding(binding)) {
            result.push({
              field: {
                type: "INDEXED_ITEM",
                collection: "effects",
                index,
                field: fieldName as EffectKeyframeFieldName,
              },
              binding: clone(binding),
            });
          }
        }
      }
    }
  }

  return result;
}

function snapshotNode(node: MotionNode, selectionIndex: number): NodeSnapshot {
  const bounds = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
  const hierarchy = hierarchyByNode.get(node.id);
  const manualTracks = collectTracks(node.manualKeyframeTracks);
  return {
    node,
    id: node.id,
    name: node.name,
    type: node.type,
    selectionIndex,
    centerX: bounds ? bounds.x + bounds.width / 2 : selectionIndex,
    centerY: bounds ? bounds.y + bounds.height / 2 : selectionIndex,
    width: bounds?.width ?? 0,
    height: bounds?.height ?? 0,
    immediateGroupId: hierarchy?.immediateGroupId ?? node.parent?.id ?? node.id,
    topGroupId: hierarchy?.topGroupId ?? node.id,
    tracks: manualTracks,
    timelines: node.timelines.map((timeline) => ({ id: timeline.id, duration: timeline.duration })),
  };
}

function hasMotionData(node: MotionNode): boolean {
  return countTracks(node.manualKeyframeTracks) > 0 || node.animationStyles.length > 0;
}

function animatedDescendants(root: MotionNode): MotionNode[] {
  const result: MotionNode[] = [];
  const visit = (node: BaseNode, topGroupId: string): void => {
    if (node !== root && isMotionNode(node) && hasMotionData(node)) {
      result.push(node);
      hierarchyByNode.set(node.id, {
        immediateGroupId: node.parent?.id ?? node.id,
        topGroupId,
      });
    }
    if ("children" in node) {
      for (const child of node.children) visit(child, node === root ? child.id : topGroupId);
    }
  };
  visit(root, root.id);
  return result;
}

function selectedNodes(): MotionNode[] {
  const resolved: MotionNode[] = [];
  const seen = new Set<string>();
  hierarchyByNode.clear();

  for (const selected of figma.currentPage.selection) {
    if (!isMotionNode(selected)) continue;

    // Motion's timeline can leave the containing frame selected even though the
    // actual tracks live on its children. Resolve such a container to its animated
    // descendants, preserving layer-tree order as the timeline-order fallback.
    const descendants = animatedDescendants(selected);
    const selectedHasMotion = hasMotionData(selected);
    if (selectedHasMotion) {
      hierarchyByNode.set(selected.id, {
        immediateGroupId: selected.parent?.id ?? selected.id,
        topGroupId: selected.id,
      });
    }
    // Include animated nested containers as well as their animated children.
    // Page-level frames usually own timelines rather than tracks, but their
    // presets must still participate so the whole selection is rejected.
    const candidates = [
      ...(selectedHasMotion && (selected.animationStyles.length > 0 ||
        !(selected.type === "FRAME" && selected.parent?.type === "PAGE")) ? [selected] : []),
      ...descendants,
    ];
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      resolved.push(candidate);
    }
  }

  return resolved;
}

function capture(nodes: MotionNode[]): SessionSnapshot {
  return { nodes: nodes.map(snapshotNode) };
}

function rememberOriginal(snapshot: SessionSnapshot): void {
  for (const node of snapshot.nodes) {
    if (!originalNodes.has(node.id)) originalNodes.set(node.id, node);
  }
}

function fieldInScope(field: KeyframeField, scope: TrackScope): boolean {
  if (scope === "all") return true;
  if (field.type === "INDEXED_ITEM") return scope === "appearance";
  if (scope === "position") return POSITION_FIELDS.has(field.name);
  if (scope === "transform") return TRANSFORM_FIELDS.has(field.name);
  if (scope === "appearance") return APPEARANCE_FIELDS.has(field.name);
  return !TRANSFORM_FIELDS.has(field.name) && !APPEARANCE_FIELDS.has(field.name);
}

function trackInScope(track: TrackSnapshot, settings: StaggerSettings): boolean {
  return fieldInScope(track.field, settings.trackScope);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function orderNodes(nodes: NodeSnapshot[], order: StaggerOrder, seed: number): NodeSnapshot[] {
  const ordered = [...nodes];
  const centerX = ordered.reduce((sum, node) => sum + node.centerX, 0) / Math.max(ordered.length, 1);
  const centerY = ordered.reduce((sum, node) => sum + node.centerY, 0) / Math.max(ordered.length, 1);
  const distance = (node: NodeSnapshot) => Math.hypot(node.centerX - centerX, node.centerY - centerY);
  const stable = (difference: number, a: NodeSnapshot, b: NodeSnapshot) =>
    difference || a.selectionIndex - b.selectionIndex;

  switch (order) {
    case "top-bottom": return ordered.sort((a, b) => stable(a.centerY - b.centerY, a, b));
    case "bottom-top": return ordered.sort((a, b) => (b.centerY - a.centerY) || (b.selectionIndex - a.selectionIndex));
    case "left-right": return ordered.sort((a, b) => stable(a.centerX - b.centerX, a, b));
    case "right-left": return ordered.sort((a, b) => (b.centerX - a.centerX) || (b.selectionIndex - a.selectionIndex));
    case "center-out": return ordered.sort((a, b) => stable(distance(a) - distance(b), a, b));
    case "edges-in": return ordered.sort((a, b) => stable(distance(b) - distance(a), a, b));
    case "random": {
      const random = seededRandom(seed);
      return ordered
        .map((node) => ({ node, value: random() }))
        .sort((a, b) => a.value - b.value)
        .map(({ node }) => node);
    }
    default: return ordered.sort((a, b) => a.selectionIndex - b.selectionIndex);
  }
}

function orderNodesByPosition(nodes: NodeSnapshot[], order: StaggerOrder, seed: number): NodeSnapshot[] {
  const ordered = [...nodes];
  const averageWidth = ordered.reduce((sum, node) => sum + node.width, 0) / Math.max(ordered.length, 1);
  const averageHeight = ordered.reduce((sum, node) => sum + node.height, 0) / Math.max(ordered.length, 1);
  const bands = (
    source: NodeSnapshot[],
    coordinate: (node: NodeSnapshot) => number,
    threshold: number,
  ): NodeSnapshot[][] => {
    const sorted = [...source].sort((a, b) =>
      (coordinate(a) - coordinate(b)) || (a.selectionIndex - b.selectionIndex),
    );
    const result: Array<{ center: number; nodes: NodeSnapshot[] }> = [];
    for (const node of sorted) {
      const value = coordinate(node);
      const current = result[result.length - 1];
      if (current && Math.abs(value - current.center) <= threshold) {
        current.nodes.push(node);
        current.center = current.nodes.reduce((sum, item) => sum + coordinate(item), 0) / current.nodes.length;
      } else {
        result.push({ center: value, nodes: [node] });
      }
    }
    return result.map((band) => band.nodes);
  };
  const rowMajor = bands(ordered, (node) => node.centerY, Math.max(2, averageHeight * 0.35))
    .flatMap((row) => row.sort((a, b) => (a.centerX - b.centerX) || (a.selectionIndex - b.selectionIndex)));
  const columnMajor = bands(ordered, (node) => node.centerX, Math.max(2, averageWidth * 0.35))
    .flatMap((column) => column.sort((a, b) => (a.centerY - b.centerY) || (a.selectionIndex - b.selectionIndex)));

  switch (order) {
    case "top-bottom": return rowMajor;
    case "bottom-top": return [...rowMajor].reverse();
    case "left-right": return columnMajor;
    case "right-left": return [...columnMajor].reverse();
    default:
      return orderNodes(ordered, order, seed);
  }
}

function ease(value: number, curve: DistributionEasing, points?: StaggerSettings["distributionBezier"]): number {
  switch (curve) {
    case "custom": return evaluateBezier(value, points!);
    case "ease-in": return value * value;
    case "ease-out": return 1 - (1 - value) * (1 - value);
    case "ease-in-out": return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
    default: return value;
  }
}

type StaggerUnit =
  | { kind: "track"; node: NodeSnapshot; index: number }
  | { kind: "keyframe"; node: NodeSnapshot; trackIndex: number; index: number };

function unitKey(unit: StaggerUnit): string {
  return unit.kind === "keyframe"
    ? `${unit.node.id}:${unit.kind}:${unit.trackIndex}:${unit.index}`
    : `${unit.node.id}:${unit.kind}:${unit.index}`;
}

function orderUnits(units: StaggerUnit[], order: StaggerOrder, seed: number): StaggerUnit[] {
  if (order === "random") {
    const random = seededRandom(seed);
    return units
      .map((unit) => ({ unit, value: random() }))
      .sort((a, b) => a.value - b.value)
      .map(({ unit }) => unit);
  }
  if (order === "bottom-top" || order === "right-left") return [...units].reverse();
  if (order === "center-out" || order === "edges-in") {
    const center = (units.length - 1) / 2;
    return [...units].sort((a, b) => {
      const aDistance = Math.abs(units.indexOf(a) - center);
      const bDistance = Math.abs(units.indexOf(b) - center);
      return order === "center-out" ? aDistance - bDistance : bDistance - aDistance;
    });
  }
  return units;
}

function getEarliest(snapshot: SessionSnapshot, settings: StaggerSettings): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const node of snapshot.nodes) {
    for (const track of node.tracks) {
      if (!trackInScope(track, settings)) continue;
      for (const keyframe of track.binding.keyframes) {
        earliest = Math.min(earliest, keyframe.timelinePosition);
      }
    }
  }
  return Number.isFinite(earliest) ? earliest : 0;
}

function resolveKeyframeEasing(settings: StaggerSettings): MotionEasing | "preserve" {
  if (settings.operation !== "easing" && (settings.staggerBy === "align" || (settings.staggerBy === "tracks" &&
    (settings.order === "align-start" || settings.order === "align-end")))) return "preserve";
  let keyframeEasing: MotionEasing | "preserve";
  if (settings.keyframeEasing === "CUSTOM_CUBIC_BEZIER") {
    if (!isBezierPoints(settings.customBezier)) {
      throw new Error("Invalid Bézier curve: use four finite coordinates with X between 0 and 1.");
    }
    const [x1, y1, x2, y2] = settings.customBezier;
    keyframeEasing = { type: "CUSTOM_CUBIC_BEZIER", easingFunctionCubicBezier: { x1, y1, x2, y2 } };
  } else {
    keyframeEasing = settings.keyframeEasing === "preserve" ? "preserve" : { type: settings.keyframeEasing };
  }
  return keyframeEasing;
}

function makeTrackInput(
  binding: ManualKeyframeBinding,
  shiftForKeyframe: (index: number) => number,
  easing: MotionEasing | "preserve",
): ManualKeyframeTrackInput {
  const keyframes = binding.keyframes.map((keyframe, index) => ({
    id: keyframe.id,
    timelinePosition: Math.max(0, keyframe.timelinePosition + shiftForKeyframe(index)),
    ...(easing === "preserve"
      ? keyframe.easing === undefined ? {} : { easing: keyframe.easing }
      : { easing }),
    value: keyframe.value,
  }));
  keyframes.sort((a, b) => a.timelinePosition - b.timelinePosition);
  return {
    id: binding.id,
    baseValue: binding.baseValue,
    keyframes,
  };
}

function restoreSnapshot(
  snapshot: SessionSnapshot,
  restoreTimelines = true,
): void {
  const timelineOwners = new Map<string, { node: MotionNode; duration: number }>();
  for (const nodeSnapshot of snapshot.nodes) {
    const node = nodeSnapshot.node;
    if (node.removed) continue;
    for (const track of nodeSnapshot.tracks) {
      node.applyManualKeyframeTrack(track.field, {
        id: track.binding.id,
        baseValue: clone(track.binding.baseValue),
        keyframes: clone(track.binding.keyframes),
      });
    }
    if (restoreTimelines) {
      for (const timeline of nodeSnapshot.timelines) {
        if (!timelineOwners.has(timeline.id)) timelineOwners.set(timeline.id, { node, duration: timeline.duration });
      }
    }
  }
  for (const [id, owner] of timelineOwners) owner.node.setTimelineDuration(id, owner.duration);
}

function cancelPreview(): void {
  if (workingBaseline) restoreWorkingPreview();
  workingBaseline = null;
  cancellationBaseline = null;
  livePreviewActive = false;
  lastPreview = null;
}

function restoreWorkingPreview(): void {
  if (!workingBaseline) return;
  restoreSnapshot(cancellationBaseline ?? workingBaseline);
  lastPreview = null;
}

function alignmentShifts(nodes: NodeSnapshot[], settings: StaggerSettings): Map<string, number> {
  const shifts = new Map<string, number>();
  if (!settings.alignment || settings.alignment === "preserve" || settings.staggerBy === "keyframes") return shifts;
  const groups = new Map<string, { start: number; end: number; keys: string[] }>();
  let earliest = Infinity;
  let latest = -Infinity;
  const add = (node: NodeSnapshot, kind: "track", index: number, start: number, end: number) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const key = unitKey({ kind, node, index });
    const groupId = settings.staggerBy === "groups"
      ? settings.groupLevel === "top-level" ? node.topGroupId : node.immediateGroupId
      : settings.staggerBy === "layers" ? node.id : key;
    const group = groups.get(groupId) ?? { start: Infinity, end: -Infinity, keys: [] };
    group.start = Math.min(group.start, start);
    group.end = Math.max(group.end, end);
    group.keys.push(key);
    groups.set(groupId, group);
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
  };
  for (const node of nodes) {
    node.tracks.forEach((track, index) => {
      if (!trackInScope(track, settings)) return;
      const range = track.binding.keyframes.reduce((bounds, frame) => ({
        start: Math.min(bounds.start, frame.timelinePosition),
        end: Math.max(bounds.end, frame.timelinePosition),
      }), { start: Infinity, end: -Infinity });
      add(node, "track", index, range.start, range.end);
    });
  }
  for (const group of groups.values()) {
    const shift = settings.alignment === "start" ? earliest - group.start : latest - group.end;
    for (const key of group.keys) shifts.set(key, shift);
  }
  return shifts;
}

function validateEasingSettings(settings: StaggerSettings): void {
  resolveKeyframeEasing(settings);
  if (settings.operation !== "easing" && settings.staggerBy !== "align" &&
    !(settings.staggerBy === "tracks" && ["align-start", "align-end"].includes(settings.order)) &&
    settings.distribution === "custom" && !isBezierPoints(settings.distributionBezier)) {
    throw new Error("Invalid stagger curve: use four finite coordinates with X between 0 and 1.");
  }
}

function applyEasingSnapshot(snapshot: SessionSnapshot, settings: StaggerSettings): StaggerResult {
  const easing = resolveKeyframeEasing(settings);
  let changedNodes = 0;
  let changedTracks = 0;
  for (const { node, tracks } of snapshot.nodes) {
    if (node.removed || !tracks.length) continue;
    changedNodes++;
    for (const { field, binding } of tracks) {
      node.applyManualKeyframeTrack(field, {
        id: binding.id,
        baseValue: binding.baseValue,
        keyframes: binding.keyframes.map(frame => ({ ...frame,
          ...(easing === "preserve" ? {} : { easing }),
        })),
      });
      changedTracks++;
    }
  }
  return { changedNodes, changedTracks, changedStyles: 0, unitCount: changedTracks, resolvedMode: "easing" };
}

function applySnapshot(snapshot: SessionSnapshot, settings: StaggerSettings): StaggerResult {
  assertManualSelection(snapshot.nodes.map(({ node }) => node));
  if (settings.operation === "easing") return applyEasingSnapshot(snapshot, settings);
  if (settings.staggerBy === "align" || (settings.staggerBy === "tracks" &&
    (settings.order === "align-start" || settings.order === "align-end"))) {
    // Alignment is a standalone operation. Saved cascade controls must not
    // offset, stretch, or change easing while this mode is active.
    const result = applySnapshot(snapshot, { ...settings, staggerBy: "tracks",
      alignment: settings.order === "align-end" || (settings.staggerBy === "align" && settings.alignment === "end") ? "end" : "start",
      spanMs: 0, order: "selection", distribution: "linear", keyframeEasing: "preserve" });
    return { ...result, resolvedMode: "align" };
  }
  if (!("motion" in figma)) throw new Error("Motion API is not available in this Figma version.");
  const keyframeEasing = resolveKeyframeEasing(settings);
  const affectedTracks = snapshot.nodes.reduce(
    (count, node) => count + node.tracks.filter((track) => trackInScope(track, settings)).length,
    0,
  );
  if (affectedTracks === 0) {
    throw new Error("The selected layers have no editable motion in the chosen scope.");
  }
  const activeNodes = snapshot.nodes.filter((node) =>
    node.tracks.some((track) => trackInScope(track, settings)),
  );
  const activeTrackCount = activeNodes.reduce(
    (count, node) => count + node.tracks.filter((track) => trackInScope(track, settings)).length,
    0,
  );
  const activeKeyframeCount = activeNodes.reduce(
    (count, node) => count + node.tracks
      .filter((track) => trackInScope(track, settings))
      .reduce((sum, track) => sum + track.binding.keyframes.length, 0),
    0,
  );
  const resolvedMode = settings.staggerBy;
  const staggerTracks = resolvedMode === "tracks";
  const staggerKeyframes = resolvedMode === "keyframes";
  const positionBased = resolvedMode === "layers" || resolvedMode === "groups";
  const temporalResize = (!settings.alignment || settings.alignment === "preserve") && !positionBased && !staggerKeyframes &&
    (settings.order === "left-right" || settings.order === "right-left");
  const spatialOrder = settings.order;
  const ordered = resolvedMode === "layers"
    ? orderNodesByPosition(activeNodes, spatialOrder, settings.randomSeed)
    : orderNodes(activeNodes, spatialOrder, settings.randomSeed);
  const earliest = getEarliest(snapshot, settings);
  const anchorSeconds = settings.anchor === "playhead"
    ? (figma.motion.playheadPosition ?? 0) + settings.startOffsetMs / 1000
    : settings.anchor === "start"
      ? settings.startOffsetMs / 1000
      : earliest + settings.startOffsetMs / 1000;
  const baseShift = anchorSeconds - earliest;
  const delayByNode = new Map<string, number>();
  const delayByUnit = new Map<string, number>();
  let resolvedGroupCount = 0;

  if (staggerTracks || staggerKeyframes) {
    let units: StaggerUnit[] = activeNodes.flatMap<StaggerUnit>((node) => [
      ...node.tracks.flatMap<StaggerUnit>((track, trackIndex): StaggerUnit[] => {
        if (!trackInScope(track, settings)) return [];
        return staggerKeyframes
          ? track.binding.keyframes.map((_, index) => ({ kind: "keyframe" as const, node, trackIndex, index }))
          : [{ kind: "track" as const, node, index: trackIndex }];
      }),
    ]);
    const naturalUnitIndex = new Map(units.map((unit, index) => [unitKey(unit), index]));
    const symmetricUnits = !temporalResize &&
      (settings.order === "center-out" || settings.order === "edges-in");
    // Symmetric orders derive delay directly from the natural unit index below.
    // Avoid the otherwise quadratic indexOf-based sort on large keyframe sets.
    if (!temporalResize && !symmetricUnits) units = orderUnits(units, settings.order, settings.randomSeed);
    units.forEach((unit, index) => {
      let progress = units.length <= 1 ? 0 : index / (units.length - 1);
      if (symmetricUnits) {
        const naturalIndex = naturalUnitIndex.get(unitKey(unit)) ?? index;
        const center = (units.length - 1) / 2;
        const distance = Math.abs(naturalIndex - center);
        const maxDistance = Math.max(center, 0.5);
        progress = settings.order === "center-out"
          ? distance / maxDistance
          : 1 - distance / maxDistance;
      }
      delayByUnit.set(unitKey(unit), ease(progress, settings.distribution, settings.distributionBezier) * settings.spanMs / 1000);
    });
  } else if (resolvedMode === "groups") {
    const grouped = new Map<string, NodeSnapshot[]>();
    for (const node of activeNodes) {
      const groupId = settings.groupLevel === "top-level" ? node.topGroupId : node.immediateGroupId;
      const members = grouped.get(groupId) ?? [];
      members.push(node);
      grouped.set(groupId, members);
    }
    const groupNodes = [...grouped.entries()].map(([groupId, members]) => ({
      ...members[0],
      id: `group:${groupId}`,
      selectionIndex: Math.min(...members.map((node) => node.selectionIndex)),
      centerX: members.reduce((sum, node) => sum + node.centerX, 0) / members.length,
      centerY: members.reduce((sum, node) => sum + node.centerY, 0) / members.length,
    }));
    resolvedGroupCount = groupNodes.length;
    const orderedGroups = orderNodesByPosition(groupNodes, spatialOrder, settings.randomSeed);
    if (settings.order === "center-out" || settings.order === "edges-in") {
      const centerX = groupNodes.reduce((sum, node) => sum + node.centerX, 0) / groupNodes.length;
      const centerY = groupNodes.reduce((sum, node) => sum + node.centerY, 0) / groupNodes.length;
      const distances = groupNodes.map((node) => Math.hypot(node.centerX - centerX, node.centerY - centerY));
      const maxDistance = Math.max(...distances, 0);
      groupNodes.forEach((group, index) => {
        const normalized = maxDistance === 0 ? 0 : distances[index] / maxDistance;
        const progress = settings.order === "center-out" ? normalized : 1 - normalized;
        const delay = ease(progress, settings.distribution, settings.distributionBezier) * settings.spanMs / 1000;
        for (const member of grouped.get(group.id.slice(6)) ?? []) delayByNode.set(member.id, delay);
      });
    } else {
      orderedGroups.forEach((group, index) => {
        const progress = orderedGroups.length <= 1 ? 0 : index / (orderedGroups.length - 1);
        const delay = ease(progress, settings.distribution, settings.distributionBezier) * settings.spanMs / 1000;
        for (const member of grouped.get(group.id.slice(6)) ?? []) delayByNode.set(member.id, delay);
      });
    }
  } else {
    if (settings.order === "center-out" || settings.order === "edges-in") {
      const centerX = activeNodes.reduce((sum, node) => sum + node.centerX, 0) / activeNodes.length;
      const centerY = activeNodes.reduce((sum, node) => sum + node.centerY, 0) / activeNodes.length;
      const distances = activeNodes.map((node) => Math.hypot(node.centerX - centerX, node.centerY - centerY));
      const maxDistance = Math.max(...distances, 0);
      activeNodes.forEach((node, index) => {
        const normalized = maxDistance === 0 ? 0 : distances[index] / maxDistance;
        const progress = settings.order === "center-out" ? normalized : 1 - normalized;
        delayByNode.set(node.id, ease(progress, settings.distribution, settings.distributionBezier) * settings.spanMs / 1000);
      });
    } else {
      ordered.forEach((node, index) => {
        const progress = ordered.length <= 1 ? 0 : index / (ordered.length - 1);
        delayByNode.set(node.id, ease(progress, settings.distribution, settings.distributionBezier) * settings.spanMs / 1000);
      });
    }
  }

  const alignments = alignmentShifts(activeNodes, settings);
  const trackDelay = (node: NodeSnapshot, index: number) => staggerTracks
    ? delayByUnit.get(unitKey({ kind: "track", node, index })) ?? 0
    : delayByNode.get(node.id) ?? 0;
  const keyframeDelay = (node: NodeSnapshot, trackIndex: number, index: number) => staggerKeyframes
    ? delayByUnit.get(unitKey({ kind: "keyframe", node, trackIndex, index })) ?? 0
    : trackDelay(node, trackIndex);
  const trackTimingShift = (
    node: NodeSnapshot,
    trackIndex: number,
    keyframeIndex: number,
    binding: ManualKeyframeBinding,
  ) => {
    const alignment = alignments.get(unitKey({ kind: "track", node, index: trackIndex })) ?? 0;
    if (!temporalResize) return alignment + keyframeDelay(node, trackIndex, keyframeIndex);
    const positions = binding.keyframes.map((keyframe) => keyframe.timelinePosition);
    const start = Math.min(...positions);
    const end = Math.max(...positions);
    if (!Number.isFinite(start) || end <= start) return 0;
    // Negative horizontal spans compress duration without reversing keyframes.
    const extension = Math.max(trackDelay(node, trackIndex), -(end - start) + 0.001);
    const position = binding.keyframes[keyframeIndex]?.timelinePosition ?? start;
    const progress = (position - start) / (end - start);
    return settings.order === "left-right"
      ? extension * progress
      : -extension * (1 - progress);
  };
  let lowestPosition = Number.POSITIVE_INFINITY;
  for (const node of snapshot.nodes) {
    node.tracks.forEach((track, index) => {
      if (!trackInScope(track, settings)) return;
      track.binding.keyframes.forEach((keyframe, keyframeIndex) => {
        const shift = baseShift + trackTimingShift(node, index, keyframeIndex, track.binding);
        lowestPosition = Math.min(lowestPosition, keyframe.timelinePosition + shift);
      });
    });
  }
  const safetyShift = Number.isFinite(lowestPosition) && lowestPosition < 0 ? -lowestPosition : 0;
  const timelineEnds = new Map<string, { node: MotionNode; duration: number }>();
  for (const nodeSnapshot of snapshot.nodes) {
    const node = nodeSnapshot.node;
    if (node.removed) continue;

    nodeSnapshot.tracks.forEach((track, index) => {
      const input = trackInScope(track, settings)
        ? makeTrackInput(
          track.binding,
          (keyframeIndex) => baseShift + trackTimingShift(nodeSnapshot, index, keyframeIndex, track.binding) + safetyShift,
          keyframeEasing,
        )
        : {
          id: track.binding.id,
          baseValue: track.binding.baseValue,
          keyframes: track.binding.keyframes,
        };
      node.applyManualKeyframeTrack(track.field, input);
    });

    let nodeEnd = 0;
    nodeSnapshot.tracks.forEach((track, index) => {
      if (!trackInScope(track, settings)) return;
      track.binding.keyframes.forEach((keyframe, keyframeIndex) => {
        const shift = baseShift + trackTimingShift(nodeSnapshot, index, keyframeIndex, track.binding) + safetyShift;
        nodeEnd = Math.max(nodeEnd, keyframe.timelinePosition + shift);
      });
    });
    for (const timeline of nodeSnapshot.timelines) {
      const existing = timelineEnds.get(timeline.id);
      const duration = Math.max(timeline.duration, nodeEnd);
      if (!existing || duration > existing.duration) timelineEnds.set(timeline.id, { node, duration });
    }
  }

  for (const [id, owner] of timelineEnds) owner.node.setTimelineDuration(id, owner.duration);
  const unitCount = resolvedMode === "layers"
    ? activeNodes.length
    : resolvedMode === "groups"
      ? resolvedGroupCount
    : resolvedMode === "tracks"
      ? activeTrackCount
      : activeKeyframeCount;
  return {
    changedNodes: activeNodes.length,
    changedTracks: affectedTracks,
    changedStyles: 0,
    unitCount,
    resolvedMode,
  };
}

function assertManualSelection(nodes: MotionNode[]): void {
  if (nodes.some(node => !node.removed && node.animationStyles.length > 0)) {
    throw new Error(PRESET_EDIT_UNSUPPORTED);
  }
}

function initializeWorkingBaseline(): void {
  const nodes = selectedNodes();
  if (nodes.length === 0) throw new Error("Select animated layers on the canvas or in the Motion timeline.");
  assertManualSelection(nodes);
  cancellationBaseline = capture(nodes);
  rememberOriginal(cancellationBaseline);
  workingBaseline = { nodes: cancellationBaseline.nodes.map((current) => {
    const original = originalNodes.get(current.id)!;
    return { ...current, tracks: original.tracks };
  }) };
}

function previewStagger(settings: StaggerSettings): void {
  validateEasingSettings(settings);
  assertManualSelection(selectedNodes());
  if (workingBaseline && (lastPreview?.stats.resolvedMode === "easing") !== (settings.operation === "easing")) cancelPreview();
  if (!workingBaseline) initializeWorkingBaseline();
  const baseline = settings.operation === "easing" ? cancellationBaseline : workingBaseline;
  if (!baseline) throw new Error("Could not capture the selected Motion tracks.");
  let stats: StaggerResult;
  try {
    stats = applySnapshot(baseline, settings);
  } catch (error) {
    restoreWorkingPreview();
    workingBaseline = null;
    cancellationBaseline = null;
    livePreviewActive = false;
    lastPreview = null;
    throw error;
  }
  livePreviewActive = true;
  lastPreview = { settings: JSON.stringify(settings), stats };
  post({ type: "preview-applied", ...stats });
  sendSelectionSummary();
}

function commitStagger(settings: StaggerSettings, selectionKey?: string): void {
  validateEasingSettings(settings);
  const nodes = selectedNodes();
  if (selectionKey !== undefined && selectionKey !== conversionSelectionKey(nodes)) {
    sendSelectionSummary();
    throw new Error("The selected layers changed. Review the refreshed selection and apply again.");
  }
  assertManualSelection(nodes);
  if (workingBaseline && (lastPreview?.stats.resolvedMode === "easing") !== (settings.operation === "easing")) cancelPreview();
  if (!workingBaseline) initializeWorkingBaseline();
  const baseline = settings.operation === "easing" ? cancellationBaseline : workingBaseline;
  if (!baseline) throw new Error("Could not capture the selected Motion tracks.");
  let stats: StaggerResult;
  try {
    const previewIsCurrent = livePreviewActive &&
      lastPreview?.settings === JSON.stringify(settings);
    stats = previewIsCurrent && lastPreview
      ? lastPreview.stats
      : applySnapshot(baseline, settings);
  } catch (error) {
    restoreWorkingPreview();
    workingBaseline = null;
    cancellationBaseline = null;
    livePreviewActive = false;
    lastPreview = null;
    throw error;
  }
  workingBaseline = null;
  cancellationBaseline = null;
  livePreviewActive = false;
  lastPreview = null;
  figma.notify(settings.operation === "easing" ? "Easing applied." : "Stagger applied.");
  post({ type: "applied", ...stats });
  sendSelectionSummary();
}

function serializePreviewNode(node: MotionNode, tracks: TrackSnapshot[]): MotionPreviewNode {
      const bounds = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
      const fills = "fills" in node && Array.isArray(node.fills) ? node.fills : [];
      const solid = fills.find(fill => fill.type === "SOLID" && fill.visible !== false);
      const fillColor = solid && solid.type === "SOLID"
        ? `rgba(${Math.round(solid.color.r * 255)}, ${Math.round(solid.color.g * 255)}, ${Math.round(solid.color.b * 255)}, ${solid.opacity ?? 1})`
        : undefined;
      const previewFields = new Set<MotionPreviewTrack["field"]>([
        "TRANSLATION_X", "TRANSLATION_Y", "ROTATION", "SCALE_X", "SCALE_Y", "OPACITY",
      ]);
      const previewTracks: MotionPreviewTrack[] = tracks.flatMap(({ field, binding }) => {
        if (field.type !== "PROPERTY") return [];
        const fields: Array<{ name: MotionPreviewTrack["field"]; component?: "x" | "y" }> =
          field.name === "TRANSLATION_XY" ? [{ name: "TRANSLATION_X", component: "x" }, { name: "TRANSLATION_Y", component: "y" }] :
          field.name === "SCALE_XY" ? [{ name: "SCALE_X", component: "x" }, { name: "SCALE_Y", component: "y" }] :
          previewFields.has(field.name as MotionPreviewTrack["field"]) ? [{ name: field.name as MotionPreviewTrack["field"] }] : [];
        return fields.flatMap(({ name, component }) => {
          const numeric = (value: KeyframeValue): number | null => component
            ? value.type === "VECTOR" ? value.value[component] : null
            : value.type === "FLOAT" ? value.value : null;
          const baseValue = numeric(binding.baseValue);
          if (baseValue === null || !Number.isFinite(baseValue)) return [];
          const keyframes = binding.keyframes.flatMap((frame) => {
            const value = numeric(frame.value);
            if (value === null || !Number.isFinite(frame.timelinePosition) || !Number.isFinite(value)) return [];
            const easing = "type" in frame.easing ? frame.easing : null;
            const curve = easing && "easingFunctionCubicBezier" in easing ? easing.easingFunctionCubicBezier : undefined;
            return [{ time: frame.timelinePosition, value,
              easing: easing?.type ?? "LINEAR",
              bezier: curve ? [curve.x1, curve.y1, curve.x2, curve.y2] as [number, number, number, number] : undefined }];
          });
          return keyframes.length ? [{ field: name, baseValue, keyframes }] : [];
        });
      });
      return { id: node.id, name: node.name, imageDataUrl: previewImages.get(node.id), artworkOpacity: "opacity" in node ? node.opacity : 1, fillColor, x: bounds?.x ?? 0, y: bounds?.y ?? 0,
        width: bounds?.width ?? 40, height: bounds?.height ?? 40, tracks: previewTracks };
}

function buildTimingPreview(nodes: MotionNode[], planned?: Map<string, TrackSnapshot[]>): NonNullable<SelectionSummary["timingPreview"]> {
  const result: TimingPreviewTrack[] = [];
  let truncated = false;
  for (const node of nodes) {
    let start = Infinity, end = -Infinity;
    for (const { binding } of planned?.get(node.id) ?? collectTracks(node.manualKeyframeTracks)) {
      for (const key of binding.keyframes) {
        if (!Number.isFinite(key.timelinePosition)) continue;
        start = Math.min(start, key.timelinePosition);
        end = Math.max(end, key.timelinePosition);
      }
    }
    if (!Number.isFinite(start)) continue;
    if (result.length >= 120) { truncated = true; break; }
    let originalStart = start, originalEnd = end;
    const original = originalNodes.get(node.id) ?? { tracks: collectTracks(node.manualKeyframeTracks) };
    if (original) {
      let low = Infinity, high = -Infinity;
      for (const { binding } of original.tracks) {
        for (const key of binding.keyframes) {
          if (!Number.isFinite(key.timelinePosition)) continue;
          low = Math.min(low, key.timelinePosition);
          high = Math.max(high, key.timelinePosition);
        }
      }
      if (Number.isFinite(low)) { originalStart = low; originalEnd = high; }
    }
    result.push({ id: node.id, nodeName: node.name, times: [start, end], originalStart, originalEnd });
  }
  const frames = figma.currentPage.selection.map(node => node.getTopLevelFrame?.() ?? node);
  const durations = frames.flatMap(frame => "timelines" in frame ? frame.timelines.map(timeline => timeline.duration) : [])
    .filter(value => Number.isFinite(value) && value > 0);
  const fallback = nodes.flatMap(node => node.timelines.map(timeline => timeline.duration)).filter(value => Number.isFinite(value) && value > 0);
  return { tracks: result, truncated, duration: durations.length ? Math.max(...durations) : fallback.length ? Math.max(...fallback) : undefined };
}

function buildSelectionSummary(): SelectionSummary {
  const nodes = selectedNodes();
  const summaries = nodes.map((node) => {
    const styleCount = node.animationStyles.length;
    return { id: node.id, name: node.name, type: node.type, trackCount: countTracks(node.manualKeyframeTracks), styleCount };
  });
  return {
    nodes: summaries,
    motionPreview: [],
    timingPreview: nodes.some(node => node.animationStyles.length > 0) ? undefined : buildTimingPreview(nodes),
    conversionSelectionKey: conversionSelectionKey(nodes),
    trackCount: summaries.reduce((sum, node) => sum + node.trackCount, 0),
    styleCount: summaries.reduce((sum, node) => sum + node.styleCount, 0),
    playheadMs: figma.motion?.playheadPosition === undefined ? undefined : Math.round(figma.motion.playheadPosition * 1000),
    canReset: originalNodes.size > 0,
  };
}

function conversionSelectionKey(nodes: MotionNode[]): string {
  // API enumeration order is not part of the conversion target identity.
  return nodes.map(node => `${node.id}:${node.animationStyles.map(style => style.id).sort().join(",")}`).sort().join("|");
}

function previewCandidates(nodes: MotionNode[]): MotionNode[] {
  // A rendered animated parent already contains its children. Keep nested
  // tracks editable, but show only the first animated layer on each branch.
  const animatedIds = new Set(nodes.map(node => node.id));
  return nodes.filter(node => {
    let parent = node.parent;
    while (parent) {
      if (animatedIds.has(parent.id)) return false;
      parent = parent.parent;
    }
    return true;
  }).slice(0, 48);
}

function planStaggerPreview(settings: StaggerSettings, requestId?: number): void {
  validateEasingSettings(settings);
  const nodes = selectedNodes();
  if (!nodes.length) throw new Error("Select animated layers on the canvas or in the Motion timeline.");
  assertManualSelection(nodes);
  const current = capture(nodes);
  const plannedTracks = new Map<string, TrackSnapshot[]>();
  const virtual: SessionSnapshot = { nodes: current.nodes.map(snapshot => {
    const baseline = originalNodes.get(snapshot.id) ?? snapshot;
    const tracks: TrackSnapshot[] = [...baseline.tracks];
    plannedTracks.set(snapshot.id, tracks);
    const node = {
      id: snapshot.id, removed: false, animationStyles: [],
      applyManualKeyframeTrack(field: KeyframeField, input: ManualKeyframeTrackInput) {
        const index = tracks.findIndex(track => JSON.stringify(track.field) === JSON.stringify(field));
        const next = { field, binding: input as ManualKeyframeBinding };
        if (index >= 0) tracks[index] = next; else tracks.push(next);
      },
      setTimelineDuration() {},
    } as unknown as MotionNode;
    return { ...snapshot, node, tracks: baseline.tracks };
  }) };
  // Reuse the Apply planner against isolated sinks. Nothing reaches a Figma node.
  applySnapshot(virtual, settings);
  post({ type: "preview-plan", requestId, timingPreview: buildTimingPreview(nodes, plannedTracks), selectionIds: nodes.map(node => node.id),
    nodes: previewCandidates(nodes).map(node => serializePreviewNode(node, plannedTracks.get(node.id) ?? [])) });
}

function sendSelectionSummary(): void {
  const summary = buildSelectionSummary();
  post({ type: "selection-summary", payload: summary });
}

figma.on("selectionchange", () => {
  if (workingBaseline) {
    restoreWorkingPreview();
    workingBaseline = null;
    cancellationBaseline = null;
    livePreviewActive = false;
    lastPreview = null;
  }
  sendSelectionSummary();
});

figma.on("close", () => {
  try {
    if (workingBaseline) restoreWorkingPreview();
  } catch {
    // Figma may already be tearing down nodes while the plugin closes.
  }
});

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  try {
    switch (message.type) {
      case "scan-selection": sendSelectionSummary(); return;
      case "cancel-preview": cancelPreview(); sendSelectionSummary(); return;
      case "resize-ui": {
        figma.ui.resize(
          Math.max(360, Math.min(520, Math.round(message.width))),
          Math.max(PLUGIN_UI.minHeight, Math.min(PLUGIN_UI.maxHeight, Math.round(message.height))),
        );
        return;
      }
      case "preview-stagger": previewStagger(message.settings); return;
      case "plan-stagger": planStaggerPreview(message.settings, message.requestId); return;
      case "apply-stagger": commitStagger(message.settings, message.selectionKey); return;
      case "convert-styles": {
        if (workingBaseline) throw new Error("Finish the current preview before converting presets.");
        const nodes = selectedNodes();
        const currentKey = conversionSelectionKey(nodes);
        if (message.selectionKey !== currentKey) {
          sendSelectionSummary();
          throw new Error("The selected layers or presets changed. Review the refreshed selection and convert again.");
        }
        const result = convertPresetSelection(nodes, PROPERTY_FIELDS);
        // Explicit conversion becomes the baseline for subsequent manual edits.
        // Reset must never reconstruct presets or discard their baked tracks.
        for (const id of result.nodeIds) originalNodes.delete(id);
        post({ type: "styles-converted", ...result });
        sendSelectionSummary();
        return;
      }
      case "reset-stagger": {
        // Before Apply, changes exist only in the UI plan. Still acknowledge
        // Reset so controls leave their busy state without a document write.
        if (originalNodes.size === 0) {
          post({ type: "reset-complete" });
          sendSelectionSummary();
          return;
        }
        restoreSnapshot({ nodes: [...originalNodes.values()] });
        originalNodes.clear();
        workingBaseline = null;
        cancellationBaseline = null;
        livePreviewActive = false;
        lastPreview = null;
        figma.notify("Motion restored to the pre-stagger state.");
        post({ type: "reset-complete" });
        sendSelectionSummary();
        return;
      }
      default: {
        const neverMessage: never = message;
        throw new Error(`Unknown message: ${JSON.stringify(neverMessage)}`);
      }
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : "Unknown Motion Stagger error";
    post({ type: "plugin-error", message: text });
  }
};

sendSelectionSummary();
