import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ButtonGroup, Folder, SelectControl as DialSelectControl, Slider } from "dialkit";
import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { ActionButton, CustomEasing, RadioControl } from "./DialControls";
import { TrackTimeline } from "./TrackTimeline";
import { ResizeHandle } from "./ResizeHandle";
import { DEFAULT_BEZIER } from "../shared/easing";
import { parseStaggerSettingsJson, stringifyStaggerSettings } from "../shared/settings-json";
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyEnd,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpLeft,
  ArrowUpRight,
  Expand,
  ListOrdered,
  Shuffle,
  Shrink,
  X,
} from "lucide-react";
import type { PluginToUiMessage, UiToPluginMessage } from "../shared/messages";
import type {
  DistributionEasing,
  KeyframeEasing,
  SelectionSummary,
  StaggerOrder,
  StaggerBy,
  StaggerSettings,
  TrackScope,
} from "../shared/types";

const DEFAULT_SETTINGS: StaggerSettings = {
  operation: "stagger",
  staggerBy: "tracks",
  groupLevel: "immediate",
  order: "top-bottom",
  distribution: "ease-out",
  distributionBezier: DEFAULT_BEZIER,
  spanMs: 0,
  startOffsetMs: 0,
  anchor: "relative",
  alignment: "preserve",
  trackScope: "all",
  keyframeEasing: "preserve",
  customBezier: DEFAULT_BEZIER,
  randomSeed: 17,
};

const ORDERS: Array<{ value: StaggerOrder; label: string }> = [
  { value: "top-bottom", label: "Top down" },
  { value: "bottom-top", label: "Bottom up" },
  { value: "left-right", label: "Left to right" },
  { value: "right-left", label: "Right to left" },
  { value: "center-out", label: "From center" },
  { value: "edges-in", label: "From edges" },
  { value: "random", label: "Random" },
  { value: "selection", label: "Selection order" },
];

const STAGGER_BY_OPTIONS: Array<{ value: StaggerBy; label: string }> = [
  { value: "tracks", label: "Tracks" },
  { value: "layers", label: "Position in frame" },
  { value: "groups", label: "Parent groups" },
  { value: "keyframes", label: "Keyframes" },
];

const KEYFRAME_EASINGS: Array<{ value: KeyframeEasing; label: string }> = [
  { value: "preserve", label: "Keep current easing" },
  { value: "CUSTOM_CUBIC_BEZIER", label: "Custom Bézier" },
  { value: "LINEAR", label: "Linear" },
  { value: "EASE_IN", label: "Ease in" },
  { value: "EASE_OUT", label: "Ease out" },
  { value: "EASE_IN_AND_OUT", label: "Ease in & out" },
  { value: "EASE_IN_BACK", label: "Back in" },
  { value: "EASE_OUT_BACK", label: "Back out" },
  { value: "EASE_IN_AND_OUT_BACK", label: "Back in & out" },
  { value: "GENTLE", label: "Gentle spring" },
  { value: "QUICK", label: "Quick spring" },
  { value: "BOUNCY", label: "Bouncy spring" },
  { value: "SLOW", label: "Slow spring" },
  { value: "HOLD", label: "Hold" },
];

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function OrderIcon({ order }: { order: StaggerOrder }) {
  if (order === "align-start") return <AlignHorizontalJustifyStart size={17} />;
  if (order === "align-end") return <AlignHorizontalJustifyEnd size={17} />;
  if (order === "center-out") return <Expand size={16} />;
  if (order === "edges-in") return <Shrink size={16} />;
  if (order === "random") return <Shuffle size={16} />;
  if (order === "selection") return <ListOrdered size={16} />;
  if (order === "top-bottom") return <ArrowDownRight size={17} />;
  if (order === "bottom-top") return <ArrowUpLeft size={17} />;
  if (order === "left-right") return <ArrowUpRight size={17} />;
  return <ArrowDownLeft size={17} />;
}

function orderDescription(order: StaggerOrder, mode: StaggerBy): string {
  const spatial = mode === "layers" || mode === "groups";
  const item = mode === "groups" ? "groups" : mode === "layers" ? "layers" : mode === "keyframes" ? "keyframes" : "tracks";
  const singular = mode === "groups" ? "group" : mode === "layers" ? "layer" : mode === "keyframes" ? "keyframe" : "track";
  switch (order) {
    case "align-start": return "Move every selected track to the same start time.";
    case "align-end": return "Move every selected track to the same end time.";
    case "top-bottom": return spatial ? `Start with the top ${singular}, then move downward.` : `Start with the first ${singular} in timeline order.`;
    case "bottom-top": return spatial ? `Start with the bottom ${singular}, then move upward.` : `Start with the last ${singular} in timeline order.`;
    case "left-right": return `Start with the leftmost ${singular}, then move right.`;
    case "right-left": return `Start with the rightmost ${singular}, then move left.`;
    case "center-out": return spatial ? `Start near the center, then move to the outer ${item}.` : `Start with the middle ${item}, then move outward.`;
    case "edges-in": return spatial ? `Start at the outer ${item}, then move toward the center.` : `Start with the first and last ${item}, then move inward.`;
    case "random": return `Stagger ${item} in a repeatable random order.`;
    case "selection": return `Keep the original order of ${item}.`;
  }
}

function SelectControl(props: ComponentProps<typeof DialSelectControl>) {
  return <div className="setting-row">
    <span className="setting-label" aria-hidden="true">{props.label}</span>
    <DialSelectControl {...props} />
  </div>;
}

function useZeroResetHandle(onReset: () => void) {
  const handlePress = useRef<{ time: number; x: number; y: number } | null>(null);
  return {
    onPointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
      const press = handlePress.current;
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) handlePress.current = null;
    },
    onPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>): boolean {
      const slider = event.target instanceof Element ? event.target.closest(".dialkit-slider") : null;
      const handle = slider?.querySelector(".dialkit-slider-handle");
      const rect = handle?.getBoundingClientRect();
      const hitsHandle = rect && event.clientX >= rect.left - 8 && event.clientX <= rect.right + 8 &&
        event.clientY >= rect.top - 8 && event.clientY <= rect.bottom + 8;
      if (!hitsHandle) { handlePress.current = null; return false; }
      const now = performance.now(), previous = handlePress.current;
      if (previous && now - previous.time <= 400 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6) {
        event.preventDefault();
        event.stopPropagation();
        handlePress.current = null;
        onReset();
        return true;
      }
      handlePress.current = { time: now, x: event.clientX, y: event.clientY };
      return false;
    },
  };
}

function ZeroResetSlider(props: ComponentProps<typeof Slider>) {
  const reset = useZeroResetHandle(() => props.onChange(0));
  return <div onPointerMoveCapture={reset.onPointerMoveCapture} onPointerDownCapture={reset.onPointerDownCapture}>
    <Slider {...props} />
  </div>;
}

function SpanControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [revision, setRevision] = useState(0);
  const committing = useRef(false);
  const reset = useZeroResetHandle(() => onChange(0));
  const min = -1000, max = 1000;
  const finish = (input: HTMLInputElement, commit: boolean) => {
    if (committing.current) return;
    committing.current = true;
    const raw = input.value.trim(), next = Number(raw.replace(",", "."));
    if (commit && raw && Number.isFinite(next)) onChange(next);
    setRevision(current => current + 1); // Close DialKit's stock input before its clamped submit.
    queueMicrotask(() => { committing.current = false; });
  };
  const resetRange = () => {
    if (value < min || value > max) flushSync(() => onChange(Math.max(min, Math.min(max, value))));
  };
  return <div className="span-control"
    onPointerMoveCapture={reset.onPointerMoveCapture}
    onBlurCapture={event => {
      if (event.target instanceof HTMLInputElement) { event.stopPropagation(); finish(event.target, true); }
    }}
    onKeyDownCapture={event => {
      if (event.target instanceof HTMLInputElement) {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          finish(event.target, event.key === "Enter");
        }
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        if (value < min || value > max) { event.preventDefault(); event.stopPropagation(); resetRange(); }
      }
    }}
    onPointerDownCapture={event => {
      if (reset.onPointerDownCapture(event)) return;
      if (!(event.target as Element).closest(".dialkit-slider-value, .dialkit-slider-input")) resetRange();
    }}>
    <Slider key={revision} label="Span" value={value} min={Math.min(min, value)} max={Math.max(max, value)} step={50} onChange={onChange} />
  </div>;
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useLayoutEffect(() => {
    const readTheme = () => setTheme(document.documentElement.classList.contains("figma-dark")
      ? "dark" : document.documentElement.classList.contains("figma-light") ? "light" : "system");
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    readTheme();
    return () => observer.disconnect();
  }, []);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [summary, setSummary] = useState<SelectionSummary>({ nodes: [], motionPreview: [], trackCount: 0, styleCount: 0, canReset: false });
  const [orderTooltip, setOrderTooltip] = useState<{ value: StaggerOrder; label: string; description: string; x: number; y: number; below: boolean } | null>(null);
  const orderTooltipTimerRef = useRef<number | null>(null);
  const hideOrderTooltip = () => {
    if (orderTooltipTimerRef.current !== null) window.clearTimeout(orderTooltipTimerRef.current);
    orderTooltipTimerRef.current = null;
    setOrderTooltip(null);
  };
  const showOrderTooltip = (button: HTMLButtonElement, option: { value: StaggerOrder; label: string }, immediate = false) => {
    hideOrderTooltip();
    const rect = button.getBoundingClientRect();
    const below = rect.top < 76;
    const tooltip = { value: option.value, label: option.label, description: orderDescription(option.value, settings.staggerBy),
      x: Math.max(130, Math.min(window.innerWidth - 130, rect.left + rect.width / 2)),
      y: below ? rect.bottom + 8 : rect.top - 8, below };
    if (immediate) setOrderTooltip(tooltip);
    else orderTooltipTimerRef.current = window.setTimeout(() => { orderTooltipTimerRef.current = null; setOrderTooltip(tooltip); }, 1000);
  };
  useEffect(() => () => {
    if (orderTooltipTimerRef.current !== null) window.clearTimeout(orderTooltipTimerRef.current);
  }, []);
  useEffect(() => { hideOrderTooltip(); }, [settings.staggerBy, summary.styleCount]);
  const [status, setStatus] = useState("Select animated layers");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<"apply" | "reset" | "convert" | null>(null);
  const [jsonMode, setJsonMode] = useState<"copy" | "paste" | null>(null);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const selectionKeyRef = useRef("");
  const planRequestRef = useRef(0);
  const [plannedTiming, setPlannedTiming] = useState<SelectionSummary["timingPreview"]>();
  const settingsRef = useRef(settings);
  const hasStylePresets = summary.styleCount > 0;
  const hasEditableMotion = summary.trackCount > 0 && !hasStylePresets;
  const showEmptyState = !hasEditableMotion;

  useEffect(() => {
    const receive = (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
      const message = event.data.pluginMessage;
      if (!message) return;
      if (message.type === "selection-summary") {
        const nextSelectionKey = (message.payload.conversionSelectionKey ?? "") + message.payload.nodes
          .map((node) => `${node.id}:${node.trackCount}:${node.styleCount}`)
          .join("|");
        const selectionChanged = nextSelectionKey !== selectionKeyRef.current;
        selectionKeyRef.current = nextSelectionKey;
        planRequestRef.current += 1;
        setPlannedTiming(undefined);
        setSummary(message.payload);
        if (selectionChanged) {
          setErrorMessage(null);
          setStatus("Ready");
          if (message.payload.trackCount > 0 && message.payload.styleCount === 0) {
            post({ type: "plan-stagger", settings: settingsRef.current, requestId: ++planRequestRef.current });
          }
        }
      } else if (message.type === "preview-plan") {
        if (message.requestId === planRequestRef.current) setPlannedTiming(message.timingPreview);
      } else if (message.type === "preview-applied") {
        setErrorMessage(null);
        setSummary((current) => ({ ...current, canReset: true }));
        setStatus("Live changes");
      } else if (message.type === "applied") {
        setErrorMessage(null);
        setBusy(false);
        setActiveAction(null);
        setStatus("Applied");
      } else if (message.type === "styles-converted") {
        setBusy(false);
        setActiveAction(null);
        setErrorMessage(null);
        setStatus("Converted to keyframes");
      } else if (message.type === "reset-complete") {
        setErrorMessage(null);
        setBusy(false);
        setActiveAction(null);
        setSummary((current) => ({ ...current, canReset: false }));
        setStatus("Restored original timing");
      } else if (message.type === "plugin-error") {
        setBusy(false);
        setActiveAction(null);
        setStatus(message.message);
        setErrorMessage(message.message);
      }
    };
    window.addEventListener("message", receive);
    post({ type: "scan-selection" });
    return () => {
      window.removeEventListener("message", receive);
    };
  }, []);

  const commitSettings = (next: StaggerSettings) => {
    settingsRef.current = next;
    setSettings(next);
    if (hasEditableMotion && !busy) post({ type: "plan-stagger", settings: next, requestId: ++planRequestRef.current });
  };
  const update = <K extends keyof StaggerSettings>(key: K, value: StaggerSettings[K]) => {
    if (summary.styleCount > 0 || busy) return;
    const next = { ...settingsRef.current, [key]: value };
    if (key === "staggerBy") {
      if (value === "tracks") {
        if (next.order === "left-right") next.order = "align-start";
        if (next.order === "right-left") next.order = "align-end";
      } else {
        if (next.order === "align-start") next.order = "left-right";
        if (next.order === "align-end") next.order = "right-left";
      }
    }
    next.alignment = "preserve";
    commitSettings(next);
  };
  const pasteSettings = (text: string) => {
    try {
      const next = parseStaggerSettingsJson(text);
      if (busy || !hasEditableMotion) return;
      commitSettings(next);
      setJsonMode(null);
      setJsonError(null);
      setErrorMessage(null);
      setStatus("Stagger settings pasted");
    } catch (error) {
      setJsonMode("paste");
      setJsonDraft(text);
      setJsonError(error instanceof Error ? error.message : "Invalid settings JSON.");
    }
  };
  const copySettings = async () => {
    const text = stringifyStaggerSettings(settingsRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setJsonMode(null);
      setJsonError(null);
      setStatus("Stagger settings copied as JSON");
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      let copied = false;
      try {
        field.select();
        copied = document.execCommand("copy");
      } catch {
        // The manual JSON field below is the final clipboard fallback.
      } finally {
        field.remove();
      }
      if (copied) {
        setJsonMode(null);
        setJsonError(null);
        setStatus("Stagger settings copied as JSON");
        return;
      }
      setJsonMode("copy");
      setJsonDraft(text);
      setJsonError("Clipboard unavailable. Select and copy the JSON below.");
    }
  };
  const pasteFromClipboard = async () => {
    if (busy) return;
    try {
      const text = await navigator.clipboard.readText();
      pasteSettings(text);
    } catch {
      setJsonMode("paste");
      setJsonDraft("");
      setJsonError(null);
    }
  };
  useEffect(() => { if (showEmptyState) hideOrderTooltip(); }, [showEmptyState]);
  const convertPresets = () => {
    if (!summary.conversionSelectionKey || busy) return;
    setBusy(true);
    setActiveAction("convert");
    setStatus("Converting…");
    post({ type: "convert-styles", selectionKey: summary.conversionSelectionKey });
  };
  const emptyState = hasStylePresets
    ? { title: "Presets selected", description: "For now, presets must be converted to keyframes before editing. Undo in Figma to restore them.",
      action: { label: busy ? "Converting…" : "Convert to keyframes", disabled: busy || !summary.conversionSelectionKey, onClick: convertPresets } }
    : summary.nodes.length === 0
      ? { title: "Nothing selected", description: "Select an animated frame or layers in Figma to edit their timing." }
      : !hasEditableMotion
        ? { title: "No editable animation", description: "Select layers with manual Motion keyframes to edit their timing." }
        : undefined;
  const isAlign = settings.staggerBy === "tracks" &&
    (settings.order === "align-start" || settings.order === "align-end");
  const orderOptions = ORDERS.map((option) => {
    if (settings.staggerBy !== "tracks") return option;
    if (option.value === "left-right") return { value: "align-start" as const, label: "Align animation starts" };
    if (option.value === "right-left") return { value: "align-end" as const, label: "Align animation ends" };
    return option;
  });
  return <><main className="shell dialkit-root" data-theme={theme}>
    {emptyState && <section className="selection-empty" aria-label={emptyState.title}>
      <strong>{emptyState.title}</strong>
      <p>{emptyState.description}</p>
      {emptyState.action && <ActionButton {...emptyState.action} />}
    </section>}
    {!showEmptyState && <div className="content" inert={busy} aria-busy={busy} onScroll={hideOrderTooltip}>
      <div className="content-body">
      <TrackTimeline preview={plannedTiming ?? summary.timingPreview} theme={theme} />
      <fieldset key={hasStylePresets ? "presets" : "manual"} className="motion-controls dialkit-root" data-theme={theme}
        disabled={hasStylePresets} inert={hasStylePresets} aria-disabled={hasStylePresets}>
      <div className="motion-controls-layout">
      {!isAlign && <div className="top-timing-row">
              <SpanControl value={settings.spanMs} onChange={(value) => update("spanMs", value)} />
              <DialSelectControl label="Stagger easing" value={settings.distribution} onChange={(value) => update("distribution", value as DistributionEasing)} options={[
                { value: "linear", label: "Linear" }, { value: "ease-in", label: "Ease in" }, { value: "ease-out", label: "Ease out" }, { value: "ease-in-out", label: "Ease in & out" }, { value: "custom", label: "Custom Bézier" },
              ]} />
      </div>}
      {!isAlign && settings.distribution === "custom" && <CustomEasing value={settings.distributionBezier ?? DEFAULT_BEZIER} onChange={(value) => update("distributionBezier", value)} />}
      <div className="stagger-order">
      <section className="order-section" aria-label="Order">
        <div className="order-grid">
          {orderOptions.map((option) => <button key={option.value} className={`order-button${settings.order === option.value ? " active" : ""}`}
            onClick={() => { hideOrderTooltip(); update("order", option.value); }}
            onMouseEnter={event => showOrderTooltip(event.currentTarget, option)} onMouseLeave={hideOrderTooltip}
            onFocus={event => showOrderTooltip(event.currentTarget, option, true)} onBlur={hideOrderTooltip}
            aria-label={option.label} aria-describedby={orderTooltip?.value === option.value ? "order-tooltip" : undefined}
            aria-pressed={settings.order === option.value}>
            <OrderIcon order={option.value} />
          </button>)}
        </div>
        {settings.staggerBy === "groups" && <div className="group-level-row"><SelectControl label="Group level" value={settings.groupLevel} options={[
          { value: "immediate", label: "Immediate parent" },
          { value: "top-level", label: "Top-level group" },
        ]} onChange={(value) => update("groupLevel", value as StaggerSettings["groupLevel"])} /></div>}
        {!isAlign && settings.order === "random" && <ActionButton label="Reshuffle pattern" onClick={() => update("randomSeed", Math.floor(Math.random() * 1_000_000))} />}
      </section>
      </div>
      <Folder title="Timing" defaultOpen={false}>
        <div className="control-stack">
          {isAlign
            ? <ZeroResetSlider label="Offset (ms)" value={settings.startOffsetMs} min={-3000} max={3000} step={50} unit="ms" onChange={(value) => update("startOffsetMs", value)} />
            : <>
              <ZeroResetSlider label="Start offset (ms)" value={settings.startOffsetMs} min={-3000} max={3000} step={50} unit="ms" onChange={(value) => update("startOffsetMs", value)} />
            </>}
          <RadioControl label="Anchor" inline value={settings.anchor} options={[
            { value: "relative", label: "Current" }, { value: "playhead", label: "Playhead" }, { value: "start", label: "0:00" },
          ]} onChange={(value) => update("anchor", value)} />
        </div>
      </Folder>
      <Folder title="Animation" defaultOpen={false}>
        <div className="control-stack">
        <div className="setting-row">
        <span className="setting-label">Stagger by</span>
        <div className="mode-grid" role="group" aria-label="Stagger by">
          {STAGGER_BY_OPTIONS.map(option => <button key={option.value} className={`mode-button${settings.staggerBy === option.value ? " active" : ""}`}
            aria-pressed={settings.staggerBy === option.value} title={option.label} onClick={() => update("staggerBy", option.value)}>{option.value === "layers" ? "Position" : option.value === "groups" ? "Groups" : option.value === "keyframes" ? "Keys" : option.label}</button>)}
        </div>
        </div>
        <SelectControl label="Tracks to edit" value={settings.trackScope} options={
          (["all", "position", "transform", "appearance", "layout"] as TrackScope[]).map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
        } onChange={(value) => update("trackScope", value as TrackScope)} />
        {!isAlign && <SelectControl label="Keyframe easing" value={settings.keyframeEasing} options={KEYFRAME_EASINGS} onChange={(value) => update("keyframeEasing", value as KeyframeEasing)} />}
        {!isAlign && settings.keyframeEasing === "CUSTOM_CUBIC_BEZIER" && <CustomEasing value={settings.customBezier ?? DEFAULT_BEZIER} onChange={(value) => update("customBezier", value)} />}
        </div>
      </Folder>
      <Folder title="Other" defaultOpen={false}>
        <div className="settings-json">
          <fieldset className="action-slot settings-json-actions" disabled={busy}>
            <ButtonGroup buttons={[
              { label: "Copy JSON", onClick: () => { void copySettings(); } },
              { label: "Paste JSON", onClick: () => { void pasteFromClipboard(); } },
            ]} />
          </fieldset>
          {jsonMode && <div className="settings-json-editor">
            <label htmlFor="settings-json-text">{jsonMode === "copy" ? "Settings JSON" : "Paste settings JSON"}</label>
            <textarea id="settings-json-text" value={jsonDraft} readOnly={jsonMode === "copy"}
              onFocus={event => { if (jsonMode === "copy") event.currentTarget.select(); }}
              onChange={event => { setJsonDraft(event.target.value); setJsonError(null); }} />
            {jsonError && <p role="alert">{jsonError}</p>}
            {jsonMode === "paste" && <ActionButton label="Apply JSON" disabled={busy} onClick={() => pasteSettings(jsonDraft)} />}
          </div>}
        </div>
        <nav className="library-links" aria-label="Open source libraries">
          <a href="https://www.dialkit.dev/" target="_blank" rel="noreferrer">DialKit · MIT</a>
          <a href="https://react.dev/" target="_blank" rel="noreferrer">React · MIT</a>
          <a href="https://motion.dev/" target="_blank" rel="noreferrer">Motion · MIT</a>
        </nav>
      </Folder>
      </div>
      </fieldset>
      </div>
    </div>}

    {errorMessage && <div className="error-message" role="alert">
      <span>{errorMessage}</span>
      <button aria-label="Dismiss error" onClick={() => setErrorMessage(null)}><X size={14} /></button>
    </div>}

    {!showEmptyState && <footer className="footer">
      <span className="visually-hidden" role="status">{status}</span>
      <ActionButton label={activeAction === "reset" ? "Restoring…" : "Reset"} loading={activeAction === "reset"} disabled={busy || (!summary.canReset && !plannedTiming && JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS))} onClick={() => {
        setBusy(true);
        setActiveAction("reset");
        planRequestRef.current += 1;
        setPlannedTiming(undefined);
        settingsRef.current = DEFAULT_SETTINGS;
        setSettings(DEFAULT_SETTINGS);
        setStatus("Restoring…");
        post({ type: "reset-stagger" });
      }} />
      <ActionButton label={activeAction === "apply" ? "Updating…" : isAlign ? "Apply alignment" : "Apply stagger"} loading={activeAction === "apply"} disabled={!hasEditableMotion || busy} onClick={() => {
        setBusy(true);
        setActiveAction("apply");
        setStatus(isAlign ? "Committing alignment…" : "Committing stagger…");
        post({ type: "apply-stagger", settings: settingsRef.current, selectionKey: summary.conversionSelectionKey });
      }} />
    </footer>}
    <ResizeHandle />
  </main>
  {!showEmptyState && orderTooltip && createPortal(<div id="order-tooltip" className={`order-tooltip dialkit-root${orderTooltip.below ? " below" : ""}`} data-theme={theme} role="tooltip"
    style={{ left: orderTooltip.x, top: orderTooltip.y }}>
    <strong>{orderTooltip.label}</strong><span>{orderTooltip.description}</span>
  </div>, document.body)}
  </>;
}
