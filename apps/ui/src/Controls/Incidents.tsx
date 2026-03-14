import { useEffect, useState } from "react";
import type { IncidentDTO, IncidentType } from "@/types";
import styles from "./Incidents.module.css";

interface IncidentsProps {
  incidents: IncidentDTO[];
  createRandom: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const INDICATOR_COLORS: Record<IncidentType, string> = {
  closure: "#f44336",
  accident: "#ff9800",
  construction: "#ffeb3b",
};

const SEVERITY_COLORS: Record<IncidentType, string> = {
  closure: "#f44336",
  accident: "#ff9800",
  construction: "#ffeb3b",
};

function formatTimeRemaining(expiresAt: number): string {
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

  // Re-render every second to update countdown timers
  useEffect(() => {
    if (incidents.length === 0) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [incidents.length]);

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>Incidents</span>
        <button className={styles.addButton} onClick={createRandom} type="button">
          +
        </button>
      </div>

      {incidents.length === 0 && <div className={styles.empty}>No active incidents</div>}

      <div className={styles.list}>
        {incidents.map((incident) => (
          <div key={incident.id} className={styles.incident}>
            <span
              className={styles.indicator}
              style={{ backgroundColor: INDICATOR_COLORS[incident.type] }}
            />
            <div className={styles.info}>
              <span className={styles.typeLabel}>{incident.type}</span>
              <div className={styles.meta}>
                <div className={styles.severityBar}>
                  <div
                    className={styles.severityFill}
                    style={{
                      width: `${incident.severity * 100}%`,
                      backgroundColor: SEVERITY_COLORS[incident.type],
                    }}
                  />
                </div>
                <span className={styles.timeRemaining}>
                  {formatTimeRemaining(incident.expiresAt)}
                </span>
              </div>
            </div>
            <button
              className={styles.removeButton}
              onClick={() => remove(incident.id)}
              title="Remove incident"
              type="button"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
