import type { AdapterStatus } from "./useAdapterConfig";
import styles from "./AdapterDrawer.module.css";

const COLOR: Record<AdapterStatus, string> = {
  healthy: "var(--color-status-onshift)",
  unhealthy: "var(--color-status-offline)",
  unreachable: "var(--color-gray)",
};

export default function HealthBadge({ status }: { status: AdapterStatus }) {
  return <span className={styles.badge} style={{ background: COLOR[status] }} title={status} />;
}
