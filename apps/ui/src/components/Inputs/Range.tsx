import { Slider, SliderTrack, SliderThumb, Label } from "react-aria-components";
import styles from "./Inputs.module.css";

interface RangeProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function Range({ label, value, min = 0, max = 100, step = 1, onChange }: RangeProps) {
  return (
    <Slider
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      onChange={onChange}
      className={styles.rangeRoot}
    >
      <div className={styles.rangeHeader}>
        <Label className={styles.label}>{label}</Label>
        <span className={styles.rangeValue}>{value}</span>
      </div>
      <SliderTrack className={styles.rangeTrack}>
        <SliderThumb className={styles.rangeThumb} aria-label={label} />
      </SliderTrack>
    </Slider>
  );
}
