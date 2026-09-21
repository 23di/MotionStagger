export const PRESET_EDIT_UNSUPPORTED = "Preset timing cannot be edited without recreating presets through the Figma Plugin API. Select layers with manual keyframes only.";

export type StaggerOrder =
  | "selection"
  | "top-bottom"
  | "bottom-top"
  | "left-right"
  | "right-left"
  | "align-start"
  | "align-end"
  | "center-out"
  | "edges-in"
  | "random";

export type DistributionEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "custom";
export type AnchorMode = "relative" | "playhead" | "start";
export type TrackScope = "all" | "position" | "transform" | "appearance" | "layout";
export type StaggerBy = "layers" | "groups" | "tracks" | "keyframes" | "align";
export type GroupLevel = "immediate" | "top-level";
export type AnimationAlignment = "preserve" | "start" | "end";
export type KeyframeEasing =
  | "preserve"
  | "CUSTOM_CUBIC_BEZIER"
  | "LINEAR"
  | "EASE_IN"
  | "EASE_OUT"
  | "EASE_IN_AND_OUT"
  | "EASE_IN_BACK"
  | "EASE_OUT_BACK"
  | "EASE_IN_AND_OUT_BACK"
  | "GENTLE"
  | "QUICK"
  | "BOUNCY"
  | "SLOW"
  | "HOLD";

export interface StaggerSettings {
  operation?: "stagger" | "easing";
  staggerBy: StaggerBy;
  groupLevel: GroupLevel;
  order: StaggerOrder;
  distribution: DistributionEasing;
  distributionBezier?: [number, number, number, number];
  spanMs: number;
  startOffsetMs: number;
  anchor: AnchorMode;
  alignment: AnimationAlignment;
  trackScope: TrackScope;
  keyframeEasing: KeyframeEasing;
  customBezier?: [number, number, number, number];
  randomSeed: number;
}

export interface SelectedNodeSummary {
  id: string;
  name: string;
  type: string;
  trackCount: number;
  styleCount: number;
}

export interface MotionPreviewTrack {
  field: "TRANSLATION_X" | "TRANSLATION_Y" | "ROTATION" | "SCALE_X" | "SCALE_Y" | "OPACITY";
  baseValue: number;
  keyframes: Array<{ time: number; value: number; easing: string; bezier?: [number, number, number, number] }>;
}

export interface MotionPreviewNode {
  /** Static layer opacity baked into the exported artwork (not the playhead). */
  artworkOpacity?: number;
  id: string;
  name: string;
  imageDataUrl?: string;
  fillColor?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tracks: MotionPreviewTrack[];
}

export interface TimingPreviewTrack {
  id: string;
  nodeName: string;
  /** Combined first and last key across all manual parameters of this layer. */
  times: [number, number];
  originalStart: number;
  originalEnd: number;
}

export interface SelectionSummary {
  timingPreview?: { tracks: TimingPreviewTrack[]; truncated: boolean; duration?: number };

  nodes: SelectedNodeSummary[];
  motionPreview: MotionPreviewNode[];
  motionPreviewFrame?: { x: number; y: number; width: number; height: number; backgroundSvg?: string };
  trackCount: number;
  styleCount: number;
  playheadMs?: number;
  canReset: boolean;
  conversionSelectionKey?: string;
}
