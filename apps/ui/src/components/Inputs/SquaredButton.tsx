import React from "react";
import styles from "./Inputs.module.css";
import classNames from "classnames";

interface SquaredButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
}

export function SquaredButton({ icon, ...props }: SquaredButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={classNames([styles.squaredButton, props.className])}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
        className: styles.squaredButtonIcon,
      })}
    </button>
  );
}
