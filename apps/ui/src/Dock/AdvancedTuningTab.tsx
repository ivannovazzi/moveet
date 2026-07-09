import { memo, useEffect } from "react";
import type { StartOptions } from "@/types";
import { Range } from "@/components/Inputs";
import { useOptions } from "@/hooks/useOptions";
import { PanelBody, PanelHeader } from "@/Controls/PanelPrimitives";

const sliders: {
  key: keyof StartOptions;
  label: string;
  min: number;
  max: number;
  step?: number;
}[] = [
  { key: "maxSpeed", label: "Speed", min: 10, max: 120 },
  { key: "acceleration", label: "Acceleration", min: 1, max: 10 },
  { key: "deceleration", label: "Deceleration", min: 1, max: 10 },
  {
    key: "updateInterval",
    label: "Update Interval",
    min: 50,
    max: 2000,
    step: 50,
  },
  {
    key: "adapterSyncInterval",
    label: "Publish Interval",
    min: 50,
    max: 10000,
    step: 50,
  },
];

export interface AdvancedTuningTabProps {
  maxSpeedRef: React.MutableRefObject<number>;
}

/**
 * Vehicle-physics + engine-cadence tuning, ported as-is from the old
 * `Controls/SpeedPanel.tsx`. Per the design doc's "Tempo / event-density
 * mechanics" section, these are real-time tuning knobs (not the Tempo
 * cluster's sim-time scrubber) and are demoted to a tab inside the Monitor
 * drawer (`MonitorDrawer.tsx`). No behavior change from `SpeedPanel`.
 */
export default memo(function AdvancedTuningTab({ maxSpeedRef }: AdvancedTuningTabProps) {
  const { options, updateOption } = useOptions(300);

  useEffect(() => {
    maxSpeedRef.current = options.maxSpeed;
  }, [options.maxSpeed, maxSpeedRef]);

  const handleChange = (field: keyof StartOptions) => (value: number) => {
    updateOption(field, value as StartOptions[typeof field]);
  };

  return (
    <>
      <PanelHeader
        title="Advanced"
        subtitle="Vehicle physics and update/publish cadence — real-time tuning, not simulated tempo."
      />
      <PanelBody className="gap-3">
        {sliders.map(({ key, label, min, max, step }) => (
          <Range
            key={key}
            label={label}
            value={options[key]}
            min={min}
            max={max}
            step={step}
            onChange={handleChange(key)}
          />
        ))}
      </PanelBody>
    </>
  );
});
