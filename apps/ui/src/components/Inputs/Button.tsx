import { useRef, useEffect } from "react";
import { Button as AriaButton, type ButtonProps } from "react-aria-components";
import classNames from "classnames";
import styles from "./Inputs.module.css";

// Omit React Aria's onClick/isDisabled to replace with standard React/HTML attrs
type ExtendedButtonProps = Omit<ButtonProps, "onClick" | "isDisabled"> & {
  /** ARIA role — applied via ref since React Aria filters out role from DOM props */
  role?: React.AriaRole;
  onClick?: React.MouseEventHandler<Element>;
  /** Standard HTML disabled attribute — mapped to React Aria's isDisabled */
  disabled?: boolean;
  isDisabled?: boolean;
};

export function Button({ className, disabled, isDisabled, role, ...props }: ExtendedButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // React Aria's filterDOMProps strips 'role', so apply it manually via ref
  useEffect(() => {
    if (ref.current && role) {
      ref.current.setAttribute("role", role);
    }
  }, [role]);

  return (
    <AriaButton
      ref={ref}
      className={classNames(styles.button, className)}
      isDisabled={isDisabled ?? disabled}
      {...(props as ButtonProps)}
    />
  );
}
