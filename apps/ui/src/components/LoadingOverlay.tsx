import styles from "./LoadingOverlay.module.css";

interface LoadingOverlayProps {
  visible: boolean;
}

export default function LoadingOverlay({ visible }: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className={styles.overlay} role="status" aria-label="Loading map data">
      <div className={styles.spinner} />
      <span className={styles.label}>Loading…</span>
    </div>
  );
}
