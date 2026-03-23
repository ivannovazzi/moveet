import classNames from "classnames";
import styles from "./LoadingOverlay.module.css";

interface LoadingOverlayProps {
  visible: boolean;
}

export default function LoadingOverlay({ visible }: LoadingOverlayProps) {
  return (
    <div
      className={classNames(styles.overlay, { [styles.hidden]: !visible })}
      role="status"
      aria-label="Loading map data"
      aria-hidden={!visible}
    >
      <div className={styles.ring}>
        <div className={styles.ringTrack} />
        <div className={styles.ringHead} />
      </div>
      <span className={styles.label}>Loading…</span>
    </div>
  );
}
