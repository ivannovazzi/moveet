import { useCallback, useEffect, useRef, useState } from "react";
import type { IncidentDTO } from "@/types";
import { Switch, SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
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

/** Left severity stripe tone — red for high-severity, amber otherwise. */
type SeverityTone = "error" | "warn";
function severityTone(severity: number): SeverityTone {
  return (severity ?? 0) >= 0.6 ? "error" : "warn";
}
const STRIPE_BG: Record<SeverityTone, string> = {
  error: "bg-status-error",
  warn: "bg-status-warn",
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

        <div className="flex flex-col">
          {incidents.map((incident) => {
            const tone = severityTone(incident.severity);
            return (
              <div
                key={incident.id}
                className="grid grid-cols-[3px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border-t border-border-soft px-2 py-2 transition-colors duration-fast ease-standard first:border-t-0 hover:bg-foreground/[0.035]"
              >
                <span
                  data-testid="severity-stripe"
                  data-tone={tone}
                  className={cn("h-[26px] w-[3px] rounded-[2px]", STRIPE_BG[tone])}
                />
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium capitalize text-foreground">
                    {incident.type}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                    {incident.position[0].toFixed(4)}, {incident.position[1].toFixed(4)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
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
                </div>
              </div>
            );
          })}
        </div>
      </PanelBody>
    </>
  );
}
