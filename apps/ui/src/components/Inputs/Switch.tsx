import React from "react";
import styles from "./Inputs.module.css";

export function Switch(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={styles.switch} {...props} />;
}
