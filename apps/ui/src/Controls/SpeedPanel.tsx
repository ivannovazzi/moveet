import { memo, useEffect } from "react";
import type { StartOptions } from "@/types";
import { Range } from "@/components/Inputs";
import { useOptions } from "@/hooks/useOptions";
import { PanelBody, PanelHeader } from "./PanelPrimitives";
import styles from "./SpeedPanel.module.css";

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
  { key: "updateInterval", label: "Update Interval", min: 50, max: 2000, step: 50 },
];

interface SpeedPanelProps {
  maxSpeedRef: React.MutableRefObject<number>;
}

export default memo(function SpeedPanel({ maxSpeedRef }: SpeedPanelProps) {
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
        title="Speed"
        subtitle="Adjust runtime speed, acceleration, and update cadence."
      />
      <PanelBody className={styles.body}>
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
