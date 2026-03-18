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

interface SourceTabProps {
  health: HealthResponse;
  config: ConfigResponse | null;
  loading: boolean;
  onConnect: (type: string, config?: Record<string, unknown>) => void;
}

export default function SourceTab({ health, config, loading, onConnect }: SourceTabProps) {
  const [selectedType, setSelectedType] = useState<string>(health.source?.type ?? "");

  const plugin = health.availableSources.find((s) => s.type === selectedType);
  const currentConfig =
    config && selectedType === config.activeSource ? config.sourceConfig[selectedType] : undefined;

  return (
    <div className={styles.tabContent}>
      <section className={styles.sectionCard}>
        <div className={styles.sectionHeading}>
          <span className={styles.sectionLabel}>Active source</span>
          <span className={styles.statusText}>
            {health.source?.healthy ? "Healthy" : health.source ? "Unhealthy" : "Not configured"}
          </span>
        </div>
        <div className={styles.summaryValue}>{health.source?.type ?? "No source connected"}</div>
      </section>

      <section className={styles.sectionCard}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Source Type</span>
          <span className={styles.fieldHint}>Select the upstream vehicle feed.</span>
          <Select
            selectedKey={selectedType}
            onSelectionChange={(key) => setSelectedType(String(key))}
            className={styles.selectRoot}
            aria-label="Source Type"
          >
            <Button className={styles.selectTrigger}>
              <SelectValue className={styles.selectValue}>
                {({ selectedText }) => selectedText || "-- select --"}
              </SelectValue>
              <span aria-hidden className={styles.selectChevron}>▾</span>
            </Button>
            <Popover className={styles.selectPopover}>
              <ListBox className={styles.selectListBox}>
                <ListBoxItem id="" textValue="-- select --" className={styles.selectItem}>
                  -- select --
                </ListBoxItem>
                {health.availableSources.map((s) => (
                  <ListBoxItem
                    key={s.type}
                    id={s.type}
                    textValue={s.type}
                    className={styles.selectItem}
                  >
                    {s.type}
                    {health.source?.type === s.type ? " (active)" : ""}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>
        </div>
      </section>

      {plugin && plugin.configSchema.length > 0 && (
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionLabel}>Configuration</span>
            <span className={styles.fieldHint}>Review and save the source settings.</span>
          </div>
          <ConfigForm
            key={selectedType}
            fields={plugin.configSchema}
            initial={currentConfig}
            submitLabel="Connect"
            loading={loading}
            onSubmit={(values) => onConnect(selectedType, values)}
          />
        </section>
      )}

      {plugin && plugin.configSchema.length === 0 && (
        <section className={styles.sectionCard}>
          <Button
            className={styles.submitBtn}
            isDisabled={loading}
            onPress={() => onConnect(selectedType)}
          >
            {loading ? "Connecting..." : "Connect source"}
          </Button>
        </section>
      )}

      {!plugin && (
        <section className={styles.emptyState}>
          Choose a source type to view and edit its configuration.
        </section>
      )}
    </div>
  );
}
