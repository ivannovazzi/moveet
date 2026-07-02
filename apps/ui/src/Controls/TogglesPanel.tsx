import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Modifiers, VehicleType } from "@/types";
import { Switch, Range } from "@/components/Inputs";
import { vehicleStore } from "@/hooks/vehicleStore";
import { PanelBody, PanelHeader } from "./PanelPrimitives";
import {
  VEHICLE_TYPE_COLORS,
  VEHICLE_TYPE_FULL_LABELS,
  VEHICLE_TYPES_ORDER,
} from "@/lib/vehicleTypeColors";

interface TogglesPanelProps {
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
  hiddenVehicleTypes: Set<VehicleType>;
  onToggleVehicleType: (type: VehicleType) => void;
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

export default memo(function TogglesPanel({
  modifiers,
  onChangeModifiers,
  hiddenVehicleTypes,
  onToggleVehicleType,
}: TogglesPanelProps) {
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
      <PanelBody className="gap-1">
        {toggles.map(({ key, label }) => (
          <label
            key={key}
            className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors duration-fast ease-standard hover:bg-accent/10"
          >
            <span className="text-sm text-muted-foreground">{label}</span>
            <Switch
              isSelected={modifiers[key]}
              onChange={onChangeModifiers(key)}
              aria-label={label}
            />
          </label>
        ))}
        <div className="mt-2 flex flex-col gap-0.5 border-t border-border-soft pt-2">
          <span className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Vehicle Types
          </span>
          {VEHICLE_TYPES_ORDER.map((type) => {
            const hidden = hiddenVehicleTypes.has(type as VehicleType);
            const label = VEHICLE_TYPE_FULL_LABELS[type];
            return (
              <label
                key={type}
                className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors duration-fast ease-standard hover:bg-accent/10"
              >
                <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm shadow-raised"
                    style={{ backgroundColor: VEHICLE_TYPE_COLORS[type] }}
                  />
                  {label}
                </span>
                <Switch
                  isSelected={!hidden}
                  onChange={() => onToggleVehicleType(type as VehicleType)}
                  aria-label={`Toggle ${label} visibility`}
                />
              </label>
            );
          })}
        </div>
        {modifiers.showBreadcrumbs && (
          <div className="flex items-center justify-between rounded-md px-3 py-2">
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
