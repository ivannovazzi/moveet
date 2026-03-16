import { useState } from "react";
import { PanelBadge, PanelHeader, PanelShell } from "../PanelPrimitives";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import SourceTab from "./SourceTab";
import SinksTab from "./SinksTab";
import styles from "./AdapterDrawer.module.css";

type Tab = "source" | "sinks";

interface AdapterDrawerProps {
  isOpen: boolean;
  health: HealthResponse | null;
  config: ConfigResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSetSource: (type: string, config?: Record<string, unknown>) => void;
  onAddSink: (type: string, config?: Record<string, unknown>) => void;
  onRemoveSink: (type: string) => void;
}

export default function AdapterDrawer({
  isOpen,
  health,
  config,
  loading,
  error,
  onClose: _onClose,
  onSetSource,
  onAddSink,
  onRemoveSink,
}: AdapterDrawerProps) {
  const [tab, setTab] = useState<Tab>("source");
  const drawerStatus = !health
    ? "Unreachable"
    : !health.source && health.sinks.length === 0
      ? "Unconfigured"
      : health.source?.healthy !== false && health.sinks.every((sink) => sink.healthy)
        ? "Healthy"
        : "Needs attention";

  return (
    <PanelShell className={styles.drawer} aria-busy={loading} aria-hidden={!isOpen}>
      <PanelHeader
        eyebrow="Adapter control"
        title="Connections"
        titleAs="h3"
        subtitle="Configure upstream source and downstream sinks."
        badge={
          <PanelBadge
            tone={
              drawerStatus === "Healthy"
                ? "healthy"
                : drawerStatus === "Needs attention"
                  ? "warning"
                  : "neutral"
            }
          >
            {drawerStatus}
          </PanelBadge>
        }
      />

      {loading && <div className={styles.loadingBar} aria-hidden="true" />}

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === "source" ? styles.tabActive : ""}`}
          onClick={() => setTab("source")}
        >
          Source
        </button>
        <button
          className={`${styles.tab} ${tab === "sinks" ? styles.tabActive : ""}`}
          onClick={() => setTab("sinks")}
        >
          Sinks ({health?.sinks.length ?? 0})
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && !config ? (
        <div className={styles.loadingPanel}>
          <div className={styles.loadingCard} />
          <div className={styles.loadingCard} />
          <div className={styles.loadingCard} />
        </div>
      ) : !health ? (
        <div className={styles.tabContent}>
          <section className={styles.emptyState}>
            Adapter service is unreachable. Check the connection settings and try again.
          </section>
        </div>
      ) : tab === "source" ? (
        <SourceTab health={health} config={config} loading={loading} onConnect={onSetSource} />
      ) : (
        <SinksTab
          health={health}
          config={config}
          loading={loading}
          onAdd={onAddSink}
          onRemove={onRemoveSink}
        />
      )}
    </PanelShell>
  );
}
