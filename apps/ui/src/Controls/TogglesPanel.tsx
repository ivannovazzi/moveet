import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Modifiers } from "@/types";
import { Switch, Range } from "@/components/Inputs";
import { vehicleStore } from "@/hooks/vehicleStore";
import { cn } from "@/lib/utils";
import { PanelBody, PanelHeader } from "./PanelPrimitives";

interface TogglesPanelProps {
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
}

const toggles: { key: keyof Modifiers; label: string }[] = [
  { key: "showDirections", label: "Network" },
  { key: "showTrafficOverlay", label: "Traffic Colours" },
  { key: "showVehicles", label: "Vehicles" },
  { key: "showHeatmap", label: "Heatmap" },
  { key: "showHeatzones", label: "Zones" },
  { key: "showPOIs", label: "POIs" },
  { key: "showSpeedLimits", label: "Speed Limits" },
  { key: "showBreadcrumbs", label: "Trails" },
];

function readStoredTrailLength(): number {
  try {
    const stored = localStorage.getItem("trailLength");
    if (stored) {
      const n = Number(stored);
      if (n >= 10 && n <= 120) return n;
    }
  } catch {
    // ignore localStorage errors
  }
  return 60;
}

export default memo(function TogglesPanel({ modifiers, onChangeModifiers }: TogglesPanelProps) {
  const [trailLength, setTrailLength] = useState(() => {
    const initial = readStoredTrailLength();
    vehicleStore.setTrailCapacity(initial);
    return initial;
  });

  // Debounce the store mutation + localStorage write: setTrailCapacity trims
  // every trail synchronously, so applying it on each slider step while
  // dragging can block the frame. The slider UI still updates immediately.
  const trailTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingTrailRef = useRef<number | null>(null);

  const commitTrailLength = useCallback((value: number) => {
    pendingTrailRef.current = null;
    vehicleStore.setTrailCapacity(value);
    try {
      localStorage.setItem("trailLength", String(value));
    } catch {
      // ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    return () => {
      // Flush a pending change on unmount instead of dropping it.
      clearTimeout(trailTimerRef.current);
      if (pendingTrailRef.current !== null) commitTrailLength(pendingTrailRef.current);
    };
  }, [commitTrailLength]);

  const handleTrailLengthChange = (value: number) => {
    setTrailLength(value);
    pendingTrailRef.current = value;
    clearTimeout(trailTimerRef.current);
    trailTimerRef.current = setTimeout(() => commitTrailLength(value), 200);
  };

  return (
    <>
      <PanelHeader
        title="Visibility"
        subtitle="Toggle map layers and overlays without leaving the panel."
      />
      <PanelBody className="gap-0">
        {toggles.map(({ key, label }) => {
          const on = modifiers[key];
          return (
            <label
              key={key}
              className="grid cursor-pointer grid-cols-[3px_1fr_auto] items-center gap-2.5 border-t border-border-soft px-2 py-[9px] transition-colors duration-fast ease-standard first:border-t-0 hover:bg-foreground/[0.035]"
            >
              <span
                className={cn("h-[26px] w-[3px] rounded-[2px]", on ? "bg-accent" : "bg-border")}
              />
              <span
                className={cn(
                  "truncate text-[12px] font-medium",
                  on ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
              <Switch isSelected={on} onChange={onChangeModifiers(key)} aria-label={label} />
            </label>
          );
        })}
        {modifiers.showBreadcrumbs && (
          <div className="grid grid-cols-[3px_1fr] items-center gap-2.5 border-t border-border-soft px-2 py-[9px]">
            <span className="h-[26px] w-[3px] rounded-[2px] bg-accent" />
            <Range
              label="Trail Length"
              value={trailLength}
              min={10}
              max={120}
              step={10}
              onChange={handleTrailLengthChange}
            />
          </div>
        )}
      </PanelBody>
    </>
  );
});
