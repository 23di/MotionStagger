import { useId, useLayoutEffect, useRef, useState } from "react";
import { ButtonGroup, EasingVisualization, TextControl } from "dialkit";
import { mountSegmentedControl, type SegmentedControlProps } from "dialkit/vanilla";
import { isBezierPoints, type BezierPoints } from "../shared/easing";

// DialKit exposes this stateless radio control through its public vanilla entry.
// Keep its own rendering, keyboard handling and selection indicator intact.
export function RadioControl<T extends string>({ label, inline = false, hideLabel = false, ...props }: SegmentedControlProps<T> & { label: string; inline?: boolean; hideLabel?: boolean }) {
  const labelId = useId();
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<ReturnType<typeof mountSegmentedControl<T>> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    control.current = mountSegmentedControl(host.current!, latest.current);
    host.current!.querySelector('[role="radiogroup"]')!.setAttribute("aria-labelledby", labelId);
    return () => { control.current?.destroy(); control.current = null; };
  }, [labelId]);
  useLayoutEffect(() => { control.current?.update(props); });
  return <div className={hideLabel ? "radio-bare" : inline ? "dialkit-labeled-control" : "setting-row"}>
    <span className={hideLabel ? "visually-hidden" : inline ? "dialkit-labeled-control-label" : "setting-label"} id={labelId}>{label}</span>
    <div ref={host} />
  </div>;
}

export function ActionButton({ label, disabled, loading = false, onClick }: { label: string; disabled?: boolean; loading?: boolean; onClick: () => void }) {
  return <fieldset className={`action-slot${loading ? " is-loading" : ""}`} disabled={disabled || loading} aria-busy={loading}>
    <ButtonGroup buttons={[{ label, onClick }]} />
  </fieldset>;
}

export function CustomEasing({ value, onChange }: { value: BezierPoints; onChange: (value: BezierPoints) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const parts = draft.split(",").map((part) => part.trim());
    const points = parts.map(Number);
    if (parts.some((part) => part === "") || !isBezierPoints(points)) {
      setError(true);
      return;
    }
    setDraft(null);
    setError(false);
    onChange(points);
  };
  return <div className="custom-easing">
    <EasingVisualization easing={{ type: "easing", duration: 1, ease: value }} onChange={(points) => {
      setDraft(null);
      setError(false);
      onChange(points);
    }} />
    <div onBlur={commit} onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        setDraft(null);
        setError(false);
      }
    }}>
      <TextControl label="Curve" value={draft ?? value.join(", ")} onChange={(text) => { setDraft(text); setError(false); }} />
    </div>
    {error && <p className="curve-error" role="alert">Use x1, y1, x2, y2. X must be between 0 and 1.</p>}
  </div>;
}
