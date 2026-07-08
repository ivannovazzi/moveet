import { useState } from "react";
import type { GeoFence, GeoFenceEvent } from "@moveet/shared-types";
import { Switch, SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { GeofenceIcon } from "@/components/Icons";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import { LRow, LList, Tag, mono, type SevTone } from "@/Dock/DockPanelKit";

interface GeofencePanelProps {
  fences: GeoFence[];
  onFenceToggle: (id: string) => void;
  onFenceDelete: (id: string) => void;
  alerts: GeoFenceEvent[];
  drawingActive: boolean;
  vertexCount: number;
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
  onConfirmDrawing: () => void;
}

type Tab = "zones" | "alerts";

/**
 * Map a zone type to a semantic tone (replaces the old hardcoded hex badge:
 * restricted→error, delivery→ok, monitoring→accent). Drives the row stripe +
 * the `Tag`, so all colour flows through design tokens.
 */
function typeTone(type: GeoFence["type"]): SevTone {
  switch (type) {
    case "restricted":
      return "error";
    case "delivery":
      return "ok";
    case "monitoring":
      return "accent";
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function GeofencePanel({
  fences,
  onFenceToggle,
  onFenceDelete,
  alerts,
  drawingActive,
  vertexCount,
  onStartDrawing,
  onCancelDrawing,
  onConfirmDrawing,
}: GeofencePanelProps) {
  const [tab, setTab] = useState<Tab>("zones");

  const canConfirm = vertexCount >= 3;

  return (
    <>
      <PanelHeader
        title="Geofences"
        subtitle={
          tab === "zones"
            ? fences.length === 0
              ? "No zones defined. Draw a zone on the map."
              : `${fences.length} zone${fences.length === 1 ? "" : "s"} defined`
            : alerts.length === 0
              ? "No geofence events yet."
              : `${alerts.length} event${alerts.length === 1 ? "" : "s"}`
        }
        badge={
          <PanelBadge tone={tab === "alerts" && alerts.length > 0 ? "warning" : "active"}>
            {tab === "zones" ? fences.length : alerts.length}
          </PanelBadge>
        }
      />

      {/* Tabs */}
      <div className="flex flex-shrink-0 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "zones"}
          className={cn(
            "-mb-px inline-flex flex-1 items-center justify-center gap-2 border-b-2 border-transparent px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
            tab === "zones" && "border-accent text-foreground"
          )}
          onClick={() => setTab("zones")}
        >
          Zones
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "alerts"}
          className={cn(
            "-mb-px inline-flex flex-1 items-center justify-center gap-2 border-b-2 border-transparent px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
            tab === "alerts" && "border-accent text-foreground"
          )}
          onClick={() => setTab("alerts")}
        >
          Alerts
          {alerts.length > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-status-warn/30 bg-status-warn/10 px-1 text-xs font-semibold text-status-warn">
              {alerts.length > 99 ? "99+" : alerts.length}
            </span>
          )}
        </button>
      </div>

      {tab === "zones" && (
        <PanelBody className="gap-3">
          {/* Drawing controls */}
          {drawingActive ? (
            <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/10 p-3">
              <span className="text-xs leading-snug text-muted-foreground">
                {vertexCount === 0
                  ? "Click on the map to add points"
                  : vertexCount < 3
                    ? `${vertexCount} point${vertexCount === 1 ? "" : "s"} — need at least 3`
                    : `${vertexCount} points — ready to confirm`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md border border-accent/40 bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition-colors duration-fast ease-standard hover:bg-accent/25 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={onConfirmDrawing}
                  disabled={!canConfirm}
                  title="Finish drawing and name the zone"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-standard hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                  onClick={onCancelDrawing}
                  title="Cancel drawing (Esc)"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md surface-accent px-3 py-2 text-left text-sm font-medium text-primary-foreground shadow-raised transition-[transform,background-color,box-shadow,color] duration-fast ease-standard hover:shadow-glow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98]"
              onClick={onStartDrawing}
              title="Draw a geofence zone on the map"
            >
              + Draw Zone
            </button>
          )}

          {fences.length === 0 ? (
            <PanelEmptyState icon={<GeofenceIcon />}>
              No zones yet. Use the &ldquo;Draw Zone&rdquo; button above to create one.
            </PanelEmptyState>
          ) : (
            <LList>
              {fences.map((fence) => (
                <LRow
                  key={fence.id}
                  tone={fence.active ? typeTone(fence.type) : "idle"}
                  primary={fence.name}
                  secondary={`${fence.polygon.length} vertices · ${fence.active ? "active" : "inactive"}`}
                  meta={
                    <>
                      <Tag tone={typeTone(fence.type)}>{fence.type}</Tag>
                      <Switch
                        isSelected={fence.active}
                        onChange={() => onFenceToggle(fence.id)}
                        aria-label={
                          fence.active ? `Deactivate ${fence.name}` : `Activate ${fence.name}`
                        }
                      />
                      <SquaredButton
                        icon={<span aria-hidden="true">×</span>}
                        variant="ghost"
                        tone="danger"
                        aria-label={`Delete ${fence.name}`}
                        title={`Delete ${fence.name}`}
                        onClick={() => onFenceDelete(fence.id)}
                      />
                    </>
                  }
                />
              ))}
            </LList>
          )}
        </PanelBody>
      )}

      {tab === "alerts" && (
        <PanelBody className="gap-3">
          {alerts.length === 0 ? (
            <PanelEmptyState icon={<GeofenceIcon />}>
              No events yet. Events appear when vehicles cross zone boundaries.
            </PanelEmptyState>
          ) : (
            <LList>
              {alerts.map((alert, i) => {
                const tone: SevTone = alert.event === "enter" ? "ok" : "error";
                return (
                  <LRow
                    key={`${alert.fenceId}-${alert.vehicleId}-${alert.timestamp}-${i}`}
                    tone={tone}
                    primary={alert.vehicleName}
                    secondary={alert.fenceName}
                    meta={
                      <>
                        <Tag tone={tone}>{alert.event}</Tag>
                        <span
                          className={cn(
                            mono,
                            "whitespace-nowrap text-[10.5px] text-muted-foreground"
                          )}
                        >
                          {formatTimestamp(alert.timestamp)}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </LList>
          )}
        </PanelBody>
      )}
    </>
  );
}
