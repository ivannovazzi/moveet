import React from "react";
import classNames from "classnames";
import styles from "./Controls.module.css";

interface BlockProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}
export function Block({ children, ...props }: BlockProps) {
  return (
    <div {...props} className={classNames([props.className, styles.block])}>
      {children}
    </div>
  );
}

export function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.item}>
      <span className={styles.itemLabel}>{label}</span>
      <span className={styles.itemValue}>{children}</span>
    </div>
  );
}
