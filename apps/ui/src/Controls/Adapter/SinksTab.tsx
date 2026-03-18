import { useState } from "react";
import {
  Button,
  Select,
  SelectValue,
  Popover,
  ListBox,
  ListBoxItem,
} from "react-aria-components";
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
                <Button
                  className={styles.removeBtn}
                  onPress={() => onRemove(sink.type)}
                  aria-label={`Remove ${sink.type}`}
                >
                  &times;
                </Button>
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
              <span aria-hidden className={styles.selectChevron}>▾</span>
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
