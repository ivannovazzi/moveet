import { useCallback, useEffect, useState } from "react";
import type { IncidentDTO, IncidentType } from "@/types";
import { Switch, SquaredButton } from "@/components/Inputs";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import styles from "./Incidents.module.css";

interface IncidentsProps {
  incidents: IncidentDTO[];
  createRandom: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const INCIDENT_COLORS: Record<IncidentType, string> = {
  closure: "#f44336",
  accident: "#ff9800",
  construction: "#ffeb3b",
};

function formatTimeRemaining(expiresAt: number): string {
  if (!Number.isFinite(expiresAt)) return "—";
  const remaining = Math.max(0, expiresAt - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default function Incidents({ incidents, createRandom, remove }: IncidentsProps) {
  const [, setTick] = useState(0);
  const [autoGenerate, setAutoGenerate] = useState(false);

  const toggleAutoGenerate = useCallback((selected: boolean) => setAutoGenerate(selected), []);

  useEffect(() => {
    if (incidents.length === 0) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [incidents.length]);

  useEffect(() => {
    if (!autoGenerate) return;
    createRandom();
    const interval = setInterval(
      () => {
        createRandom();
      },
      15000 + Math.random() * 15000
    );
    return () => clearInterval(interval);
  }, [autoGenerate, createRandom]);

  return (
    <>
      <PanelHeader
        title="Incidents"
        subtitle={
          incidents.length === 0
            ? "Monitor closures, accidents, and construction events."
            : `${incidents.length} active disruptions on the network`
        }
        badge={<PanelBadge>{incidents.length}</PanelBadge>}
      />

      <PanelBody className={styles.body}>
        <div className={styles.controlRow}>
          <label className={styles.autoLabel}>
            <Switch
              isSelected={autoGenerate}
              onChange={toggleAutoGenerate}
              aria-label="Auto-generate incidents"
            />
            <span className={styles.autoText}>Auto</span>
          </label>
          <SquaredButton
            icon={<span aria-hidden="true">+</span>}
            variant="surface"
            aria-label="Create incident"
            title="Create incident"
            onClick={createRandom}
          />
        </div>
        {incidents.length === 0 ? <PanelEmptyState>No active incidents</PanelEmptyState> : null}

        <div className={styles.list}>
          {incidents.map((incident) => (
            <div key={incident.id} className={styles.incident}>
              <span
                className={styles.indicator}
                style={{ backgroundColor: INCIDENT_COLORS[incident.type] }}
              />
              <div className={styles.info}>
                <span className={styles.typeLabel}>{incident.type}</span>
                <div className={styles.meta}>
                  <div className={styles.severityBar}>
                    <div
                      className={styles.severityFill}
                      style={{
                        width: `${(incident.severity ?? 0) * 100}%`,
                        backgroundColor: INCIDENT_COLORS[incident.type],
                      }}
                    />
                  </div>
                  <span className={styles.timeRemaining}>
                    {formatTimeRemaining(incident.expiresAt)}
                  </span>
                </div>
              </div>
              <SquaredButton
                className={styles.removeButton}
                icon={<span aria-hidden="true">×</span>}
                variant="ghost"
                tone="danger"
                aria-label="Remove incident"
                title="Remove incident"
                onClick={() => remove(incident.id)}
              />
            </div>
          ))}
        </div>
      </PanelBody>
    </>
  );
}
