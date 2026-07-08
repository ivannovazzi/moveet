import { useCallback, useEffect, useRef, useState } from "react";
import type { IncidentDTO } from "@/types";
import { Switch, SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { AlertIcon } from "@/components/Icons";
import { LList, LRow, Tag, mono, type SevTone } from "@/Dock/DockPanelKit";
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

/**
 * Bucket the 0–1 severity float into a three-tier stripe/tag tone so the row
 * carries more than a binary error/warn signal: critical (red), elevated
 * (amber), minor (idle grey). The exact float is still surfaced numerically.
 */
function severityTone(severity: number): SevTone {
  const s = severity ?? 0;
  if (s >= 0.66) return "error";
  if (s >= 0.33) return "warn";
  return "idle";
}

function formatSeverity(severity: number): string {
  return `${Math.round((severity ?? 0) * 100)}%`;
}

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

        <LList className="px-0 pb-0 pt-0">
          {incidents.map((incident) => {
            const tone = severityTone(incident.severity);
            return (
              <LRow
                key={incident.id}
                tone={tone}
                primary={<span className="capitalize">{incident.type}</span>}
                secondary={`${incident.position[0].toFixed(4)}, ${incident.position[1].toFixed(4)}`}
                meta={
                  <>
                    <Tag tone={tone}>{formatSeverity(incident.severity)}</Tag>
                    <span
                      className={cn(mono, "whitespace-nowrap text-[11px] text-muted-foreground")}
                    >
                      {formatTimeRemaining(incident.expiresAt)}
                    </span>
                    <SquaredButton
                      className="flex-shrink-0"
                      icon={<span aria-hidden="true">×</span>}
                      variant="ghost"
                      tone="danger"
                      aria-label="Remove incident"
                      title="Remove incident"
                      onClick={() => remove(incident.id)}
                    />
                  </>
                }
              />
            );
          })}
        </LList>
      </PanelBody>
    </>
  );
}
