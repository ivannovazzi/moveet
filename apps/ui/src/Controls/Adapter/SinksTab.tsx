import { useState } from "react";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import ConfigForm from "./ConfigForm";
import styles from "./AdapterDrawer.module.css";

interface SinksTabProps {
  health: HealthResponse;
  config: ConfigResponse | null;
  loading: boolean;
  onAdd: (type: string, config?: Record<string, unknown>) => void;
  onRemove: (type: string) => void;
}

export default function SinksTab({ health, config, loading, onAdd, onRemove }: SinksTabProps) {
  const [addingType, setAddingType] = useState("");

  const activeSinks = health.sinks;
  const availableToAdd = health.availableSinks.filter(
    (s) => !activeSinks.some((a) => a.type === s.type)
  );
  const addPlugin = health.availableSinks.find((s) => s.type === addingType);

  return (
    <div className={styles.tabContent}>
      {activeSinks.length > 0 && (
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionLabel}>Active sinks</span>
            <span className={styles.statusText}>{activeSinks.length} connected</span>
          </div>
          <div className={styles.sinkList}>
            {activeSinks.map((sink) => (
              <div key={sink.type} className={styles.sinkItem}>
                <div className={styles.sinkMeta}>
                  <span
                    className={styles.statusDot}
                    style={{
                      background: sink.healthy
                        ? "var(--color-status-onshift)"
                        : "var(--color-status-offline)",
                    }}
                  />
                  <span className={styles.sinkName}>{sink.type}</span>
                </div>
                <span className={styles.statusText}>{sink.healthy ? "Healthy" : "Unhealthy"}</span>
                <button
                  className={styles.removeBtn}
                  onClick={() => onRemove(sink.type)}
                  title={`Remove ${sink.type}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {activeSinks.length === 0 && <section className={styles.emptyState}>No active sinks</section>}

      {availableToAdd.length > 0 && (
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionLabel}>Add sink</span>
            <span className={styles.fieldHint}>Attach another downstream target.</span>
          </div>
          <select
            className={styles.input}
            value={addingType}
            onChange={(e) => setAddingType(e.target.value)}
          >
            <option value="">-- select type --</option>
            {availableToAdd.map((s) => (
              <option key={s.type} value={s.type}>
                {s.type}
              </option>
            ))}
          </select>

          {addPlugin && addPlugin.configSchema.length > 0 && (
            <>
              <div className={styles.sectionHeading}>
                <span className={styles.sectionLabel}>Configuration</span>
                <span className={styles.fieldHint}>Enter the sink connection details.</span>
              </div>
              <ConfigForm
                key={addingType}
                fields={addPlugin.configSchema}
                initial={config?.sinkConfig[addingType]}
                submitLabel="Add"
                loading={loading}
                onSubmit={(values) => {
                  onAdd(addingType, values);
                  setAddingType("");
                }}
              />
            </>
          )}

          {addPlugin && addPlugin.configSchema.length === 0 && (
            <button
              className={styles.submitBtn}
              disabled={loading}
              onClick={() => {
                onAdd(addingType);
                setAddingType("");
              }}
            >
              {loading ? "Adding..." : "Add sink"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
