import React from "react";
import styles from "./Inputs.module.css";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Range({ label, value, min, max, step, onChange }: InputProps) {
  return (
    <label className={styles.label}>
      <span className={styles.rangeHeader}>
        <span>{label}</span>
        <span className={styles.rangeValue}>{value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        className={styles.range}
      />
    </label>
  );
}
