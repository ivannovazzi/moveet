import type { ConfigResponse } from "./adapterClient";
import ConfigForm from "./ConfigForm";
import styles from "./AdapterDrawer.module.css";

interface RealismTabProps {
  config: ConfigResponse | null;
  loading: boolean;
  onSetRealism: (config: Record<string, unknown>) => void;
}

export default function RealismTab({ config, loading, onSetRealism }: RealismTabProps) {
  const realism = config?.realism;
  if (!realism) {
    return (
      <div className={styles.tabContent}>
        <section className={styles.emptyState}>Realism unavailable</section>
      </div>
    );
  }
  const s = realism.status;
  return (
    <div className={styles.tabContent}>
      <section className={styles.sectionCard}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionLabel}>Live status</span>
          <span className={styles.statusText}>{s.enabled ? "Active" : "Off"}</span>
        </div>
        <dl className={styles.sinkConfigSummary}>
          <div className={styles.sinkConfigRow}>
            <dt className={styles.sinkConfigKey}>devices</dt>
            <dd className={styles.sinkConfigVal}>{s.devices}</dd>
          </div>
          <div className={styles.sinkConfigRow}>
            <dt className={styles.sinkConfigKey}>connected</dt>
            <dd className={styles.sinkConfigVal}>{s.connected}</dd>
          </div>
          <div className={styles.sinkConfigRow}>
            <dt className={styles.sinkConfigKey}>degraded</dt>
            <dd className={styles.sinkConfigVal}>{s.degraded}</dd>
          </div>
          <div className={styles.sinkConfigRow}>
            <dt className={styles.sinkConfigKey}>disconnected</dt>
            <dd className={styles.sinkConfigVal}>{s.disconnected}</dd>
          </div>
          <div className={styles.sinkConfigRow}>
            <dt className={styles.sinkConfigKey}>buffered</dt>
            <dd className={styles.sinkConfigVal}>{s.buffered}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.sectionCard}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionLabel}>Configuration</span>
          <span className={styles.fieldHint}>Applied live to all sinks.</span>
        </div>
        <ConfigForm
          key="realism"
          fields={realism.schema}
          initial={realism.config}
          submitLabel="Save"
          loading={loading}
          onSubmit={(values) => onSetRealism(values)}
        />
      </section>
    </div>
  );
}
