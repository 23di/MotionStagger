import type { MotionPreviewNode, SelectionSummary, StaggerBy, StaggerSettings } from "./types";

export type UiToPluginMessage =
  | { type: "scan-selection" }
  | { type: "cancel-preview" }
  | { type: "preview-stagger"; settings: StaggerSettings }
  | { type: "plan-stagger"; settings: StaggerSettings; requestId?: number }
  | { type: "apply-stagger"; settings: StaggerSettings; selectionKey?: string }
  | { type: "convert-styles"; selectionKey: string }
  | { type: "reset-stagger" }
  | { type: "resize-ui"; width: number; height: number };

export type PluginToUiMessage =
  | { type: "selection-summary"; payload: SelectionSummary }
  | { type: "preview-images"; selectionIds: string[]; images: Record<string, string> }
  | { type: "preview-plan"; selectionIds: string[]; nodes: MotionPreviewNode[]; timingPreview?: SelectionSummary["timingPreview"]; requestId?: number }
  | { type: "preview-applied"; changedNodes: number; changedTracks: number; changedStyles: number; unitCount: number; resolvedMode: StaggerBy | "easing" }
  | { type: "applied"; changedNodes: number; changedTracks: number; changedStyles: number; unitCount: number; resolvedMode: StaggerBy | "easing" }
  | { type: "styles-converted"; nodeIds: string[]; convertedStyles: number; convertedTracks: number }
  | { type: "reset-complete" }
  | { type: "plugin-error"; message: string };
