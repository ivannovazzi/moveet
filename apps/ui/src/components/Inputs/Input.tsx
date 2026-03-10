import React from "react";
import styles from "./Inputs.module.css";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, value, onChange, ...props }: InputProps) {
  return (
    <label className={styles.label}>
      {label}
      <input type="number" value={value} onChange={onChange} className={styles.input} {...props} />
    </label>
  );
}
