import { Switch as AriaSwitch, type SwitchProps } from "react-aria-components";
import styles from "./Inputs.module.css";

export function Switch(props: Omit<SwitchProps, "children">) {
  return (
    <AriaSwitch {...props} className={styles.switch}>
      <div className={styles.switchIndicator} />
    </AriaSwitch>
  );
}
