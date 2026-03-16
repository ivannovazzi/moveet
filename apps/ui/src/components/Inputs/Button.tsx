import React from "react";
import classNames from "classnames";
import styles from "./Inputs.module.css";

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={classNames(styles.button, className)} {...props} />;
}
