import { useState } from "react";
import { Button, Select, SelectValue, Popover, ListBox, ListBoxItem } from "react-aria-components";
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

/** Render a (redacted) config value for the read-only summary line. */
function formatConfigValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function SinksTab({ health, config, loading, onAdd, onRemove }: SinksTabProps) {
  const [addingType, setAddingType] = useState("");
  const [editingType, setEditingType] = useState<string | null>(null);

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
            {activeSinks.map((sink) => {
              const schema =
                health.availableSinks.find((s) => s.type === sink.type)?.configSchema ?? [];
              const current = config?.sinkConfig[sink.type];
              const entries = current ? Object.entries(current) : [];
              const isEditing = editingType === sink.type;
              return (
                <div key={sink.type} className={styles.sinkEntry}>
                  <div className={styles.sinkItem}>
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
                    <span className={styles.statusText}>
                      {sink.healthy ? "Healthy" : "Unhealthy"}
                    </span>
                    <div className={styles.sinkActions}>
                      {schema.length > 0 && (
                        <Button
                          className={styles.editBtn}
                          onPress={() => setEditingType(isEditing ? null : sink.type)}
                          aria-label={`${isEditing ? "Cancel editing" : "Edit"} ${sink.type}`}
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </Button>
                      )}
                      <Button
                        className={styles.removeBtn}
                        onPress={() => onRemove(sink.type)}
                        aria-label={`Remove ${sink.type}`}
                      >
                        &times;
                      </Button>
                    </div>
                  </div>

                  {!isEditing && entries.length > 0 && (
                    <dl className={styles.sinkConfigSummary}>
                      {entries.map(([key, value]) => (
                        <div key={key} className={styles.sinkConfigRow}>
                          <dt className={styles.sinkConfigKey}>{key}</dt>
                          <dd className={styles.sinkConfigVal}>{formatConfigValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {isEditing && schema.length > 0 && (
                    <ConfigForm
                      key={`edit-${sink.type}`}
                      fields={schema}
                      initial={current}
                      submitLabel="Save"
                      loading={loading}
                      onSubmit={(values) => {
                        onAdd(sink.type, values);
                        setEditingType(null);
                      }}
                    />
                  )}
                </div>
              );
            })}
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
          <Select
            selectedKey={addingType}
            onSelectionChange={(key) => setAddingType(String(key))}
            className={styles.selectRoot}
            aria-label="Sink Type"
          >
            <Button className={styles.selectTrigger}>
              <SelectValue className={styles.selectValue}>
                {({ selectedText }) => selectedText || "-- select type --"}
              </SelectValue>
              <span aria-hidden className={styles.selectChevron}>
                ▾
              </span>
            </Button>
            <Popover className={styles.selectPopover}>
              <ListBox className={styles.selectListBox}>
                <ListBoxItem id="" textValue="-- select type --" className={styles.selectItem}>
                  -- select type --
                </ListBoxItem>
                {availableToAdd.map((s) => (
                  <ListBoxItem
                    key={s.type}
                    id={s.type}
                    textValue={s.type}
                    className={styles.selectItem}
                  >
                    {s.type}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>

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
            <Button
              className={styles.submitBtn}
              isDisabled={loading}
              onPress={() => {
                onAdd(addingType);
                setAddingType("");
              }}
            >
              {loading ? "Adding..." : "Add sink"}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
