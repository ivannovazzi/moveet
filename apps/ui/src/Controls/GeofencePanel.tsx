import { useState } from "react";
import type { GeoFence, GeoFenceEvent } from "@moveet/shared-types";
import { Switch, SquaredButton } from "@/components/Inputs";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import styles from "./GeofencePanel.module.css";

interface GeofencePanelProps {
  fences: GeoFence[];
  onFenceToggle: (id: string) => void;
  onFenceDelete: (id: string) => void;
  alerts: GeoFenceEvent[];
}

type Tab = "zones" | "alerts";

function typeBadgeColor(type: GeoFence["type"]): string {
  switch (type) {
    case "restricted":
      return "#ef4444";
    case "delivery":
      return "#22c55e";
    case "monitoring":
      return "#3b82f6";
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

export default function GeofencePanel({
  fences,
  onFenceToggle,
  onFenceDelete,
  alerts,
}: GeofencePanelProps) {
  const [tab, setTab] = useState<Tab>("zones");

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
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "zones"}
          className={styles.tab}
          data-active={tab === "zones" ? "true" : undefined}
          onClick={() => setTab("zones")}
        >
          Zones
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "alerts"}
          className={styles.tab}
          data-active={tab === "alerts" ? "true" : undefined}
          onClick={() => setTab("alerts")}
        >
          Alerts
          {alerts.length > 0 && (
            <span className={styles.alertCount}>{alerts.length > 99 ? "99+" : alerts.length}</span>
          )}
        </button>
      </div>

      {tab === "zones" && (
        <PanelBody className={styles.body}>
          {fences.length === 0 ? (
            <PanelEmptyState>
              No zones yet. Use the &ldquo;Draw Zone&rdquo; button to create one.
            </PanelEmptyState>
          ) : (
            <div className={styles.list}>
              {fences.map((fence) => (
                <div key={fence.id} className={styles.fenceRow}>
                  <span
                    className={styles.typeDot}
                    style={{
                      backgroundColor: fence.color ?? typeBadgeColor(fence.type),
                    }}
                  />
                  <span className={styles.typeBadge} style={{ color: fence.color ?? typeBadgeColor(fence.type) }}>
                    {fence.type}
                  </span>
                  <span className={styles.fenceName}>{fence.name}</span>
                  <div className={styles.fenceActions}>
                    <Switch
                      isSelected={fence.active}
                      onChange={() => onFenceToggle(fence.id)}
                      aria-label={fence.active ? `Deactivate ${fence.name}` : `Activate ${fence.name}`}
                    />
                    <SquaredButton
                      icon={<span aria-hidden="true">×</span>}
                      variant="ghost"
                      tone="danger"
                      aria-label={`Delete ${fence.name}`}
                      title={`Delete ${fence.name}`}
                      onClick={() => onFenceDelete(fence.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelBody>
      )}

      {tab === "alerts" && (
        <PanelBody className={styles.body}>
          {alerts.length === 0 ? (
            <PanelEmptyState>No events yet. Events appear when vehicles cross zone boundaries.</PanelEmptyState>
          ) : (
            <div className={styles.list}>
              {alerts.map((alert, i) => (
                <div key={`${alert.fenceId}-${alert.vehicleId}-${alert.timestamp}-${i}`} className={styles.alertRow}>
                  <span
                    className={styles.eventBadge}
                    data-event={alert.event}
                  >
                    {alert.event}
                  </span>
                  <div className={styles.alertInfo}>
                    <span className={styles.alertVehicle}>{alert.vehicleName}</span>
                    <span className={styles.alertZone}>{alert.fenceName}</span>
                  </div>
                  <span className={styles.alertTime}>{formatTimestamp(alert.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </PanelBody>
      )}
    </>
  );
}
