import { useState } from "react";
import type { GeoFence, GeoFenceEvent } from "@moveet/shared-types";
import { Button, Switch } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { GeofenceIcon } from "@/components/Icons";
import { MIN_GEOFENCE_VERTICES, drawProgressHint } from "@/lib/geofenceHints";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelHeader,
  PanelRow,
  RowDeleteButton,
} from "./PanelPrimitives";

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

function typeBadgeColor(type: GeoFence["type"]): string {
  switch (type) {
    case "restricted":
      return "var(--color-geofence-restricted)";
    case "delivery":
      return "var(--color-geofence-delivery)";
    case "monitoring":
      return "var(--color-geofence-monitoring)";
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

  const canConfirm = vertexCount >= MIN_GEOFENCE_VERTICES;

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
            "-mb-px inline-flex flex-1 items-center justify-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground",
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
            "-mb-px inline-flex flex-1 items-center justify-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground",
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
                {drawProgressHint(vertexCount) ?? `${vertexCount} points — ready to confirm`}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1"
                  onClick={onConfirmDrawing}
                  isDisabled={!canConfirm}
                  title="Finish drawing and name the zone"
                >
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancelDrawing}
                  title="Cancel drawing (Esc)"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md surface-accent px-3 py-2 text-left text-sm font-medium text-primary-foreground shadow-raised transition-[transform,background-color,box-shadow,color] duration-fast ease-standard hover:shadow-glow-accent active:scale-[0.98]"
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
            <div className="flex flex-col gap-0">
              {fences.map((fence) => (
                <PanelRow key={fence.id} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: fence.color ?? typeBadgeColor(fence.type),
                    }}
                  />
                  <span
                    className="min-w-[72px] flex-shrink-0 text-xs font-medium capitalize tracking-wide"
                    style={{ color: fence.color ?? typeBadgeColor(fence.type) }}
                  >
                    {fence.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {fence.name}
                  </span>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Switch
                      isSelected={fence.active}
                      onChange={() => onFenceToggle(fence.id)}
                      aria-label={
                        fence.active ? `Deactivate ${fence.name}` : `Activate ${fence.name}`
                      }
                    />
                    <RowDeleteButton
                      label={`Delete ${fence.name}`}
                      onClick={() => onFenceDelete(fence.id)}
                    />
                  </div>
                </PanelRow>
              ))}
            </div>
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
            <div className="flex flex-col gap-0">
              {alerts.map((alert, i) => (
                <PanelRow
                  key={`${alert.fenceId}-${alert.vehicleId}-${alert.timestamp}-${i}`}
                  hoverable={false}
                  className="flex items-center gap-3"
                >
                  <span
                    data-event={alert.event}
                    className={cn(
                      "flex-shrink-0 rounded-sm border px-2 py-px text-xs font-semibold uppercase tracking-wide",
                      alert.event === "enter"
                        ? "border-status-ok/20 bg-status-ok/15 text-status-ok"
                        : "border-status-error/20 bg-status-error/15 text-status-error"
                    )}
                  >
                    {alert.event}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[13px] text-foreground">
                      {alert.vehicleName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {alert.fenceName}
                    </span>
                  </div>
                  <span className="flex-shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {formatTimestamp(alert.timestamp)}
                  </span>
                </PanelRow>
              ))}
            </div>
          )}
        </PanelBody>
      )}
    </>
  );
}
