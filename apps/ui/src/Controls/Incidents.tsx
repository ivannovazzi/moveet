import { useCallback, useEffect, useRef, useState } from "react";
import type { IncidentDTO, IncidentType } from "@/types";
import { Switch, SquaredButton } from "@/components/Inputs";
import { AlertIcon } from "@/components/Icons";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelErrorState,
  PanelHeader,
} from "./PanelPrimitives";

interface IncidentsProps {
  incidents: IncidentDTO[];
  createRandom: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  error?: string | null;
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

export default function Incidents({ incidents, createRandom, remove, error }: IncidentsProps) {
  const [, setTick] = useState(0);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const createRandomRef = useRef(createRandom);
  createRandomRef.current = createRandom;

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
    createRandomRef.current();
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      const ms = 15_000 + Math.random() * 15_000;
      timeoutId = setTimeout(() => {
        createRandomRef.current();
        scheduleNext();
      }, ms);
    };
    scheduleNext();
    return () => clearTimeout(timeoutId);
  }, [autoGenerate]);

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

      <PanelBody className="gap-3">
        <div className="flex items-center justify-between">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Switch
              isSelected={autoGenerate}
              onChange={toggleAutoGenerate}
              aria-label="Auto-generate incidents"
            />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Auto</span>
          </label>
          <SquaredButton
            icon={<span aria-hidden="true">+</span>}
            variant="ghost"
            tone="active"
            active
            aria-label="Create incident"
            title="Create incident"
            onClick={createRandom}
          />
        </div>
        {error ? <PanelErrorState>{error}</PanelErrorState> : null}
        {incidents.length === 0 && !error ? (
          <PanelEmptyState icon={<AlertIcon />}>No active incidents</PanelEmptyState>
        ) : null}

        <div className="flex flex-col gap-2">
          {incidents.map((incident) => (
            <div
              key={incident.id}
              className="flex items-center gap-3 rounded-md border border-border-soft bg-white/[0.03] px-2.5 py-2 transition-colors duration-fast ease-standard hover:bg-white/[0.06]"
            >
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: INCIDENT_COLORS[incident.type] }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[13px] capitalize text-foreground">{incident.type}</span>
                <div className="flex items-center gap-3">
                  <div className="h-1 w-12 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
                    <div
                      className="h-full rounded-sm transition-[width] duration-normal ease-standard"
                      style={{
                        width: `${(incident.severity ?? 0) * 100}%`,
                        backgroundColor: INCIDENT_COLORS[incident.type],
                      }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {formatTimeRemaining(incident.expiresAt)}
                  </span>
                </div>
              </div>
              <SquaredButton
                className="flex-shrink-0"
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
