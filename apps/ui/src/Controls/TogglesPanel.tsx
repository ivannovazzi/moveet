import { useState } from "react";
import type { Modifiers } from "@/types";
import { Switch, Range } from "@/components/Inputs";
import { eValue } from "@/utils/form";
import { vehicleStore } from "@/hooks/vehicleStore";
import { PanelBody, PanelHeader } from "./PanelPrimitives";
import styles from "./TogglesPanel.module.css";

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

export default function TogglesPanel({ modifiers, onChangeModifiers }: TogglesPanelProps) {
  const [trailLength, setTrailLength] = useState(() => {
    const initial = readStoredTrailLength();
    vehicleStore.setTrailCapacity(initial);
    return initial;
  });

  const handleTrailLengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setTrailLength(value);
    vehicleStore.setTrailCapacity(value);
    try {
      localStorage.setItem("trailLength", String(value));
    } catch {
      // ignore localStorage errors
    }
  };

  return (
    <>
      <PanelHeader
        title="Visibility"
        subtitle="Toggle map layers and overlays without leaving the panel."
      />
      <PanelBody className={styles.body}>
        {toggles.map(({ key, label }) => (
          <label key={key} className={styles.row}>
            <span className={styles.label}>{label}</span>
            <Switch
              checked={modifiers[key]}
              onChange={eValue(onChangeModifiers(key))}
              aria-label={label}
            />
          </label>
        ))}
        {modifiers.showBreadcrumbs && (
          <div className={styles.row}>
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
}
