import { useState } from "react";
import type { CreateGeoFenceRequest, GeoFenceType } from "@moveet/shared-types";
import styles from "./CreateZoneDialog.module.css";

interface CreateZoneDialogProps {
  polygon: [number, number][] | null;
  onSubmit: (req: CreateGeoFenceRequest) => void;
  onClose: () => void;
}

const FENCE_TYPES: GeoFenceType[] = ["restricted", "delivery", "monitoring"];

export default function CreateZoneDialog({ polygon, onSubmit, onClose }: CreateZoneDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<GeoFenceType>("monitoring");
  const [color, setColor] = useState("");

  if (polygon === null) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const req: CreateGeoFenceRequest = {
      name: name.trim(),
      type,
      polygon,
      ...(color ? { color } : {}),
    };
    onSubmit(req);
    setName("");
    setType("monitoring");
    setColor("");
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Create geofence zone"
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create Zone</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="zone-name">
              Name <span className={styles.required}>*</span>
            </label>
            <input
              id="zone-name"
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Zone name"
              required
              autoFocus
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="zone-type">
              Type
            </label>
            <select
              id="zone-type"
              className={styles.select}
              value={type}
              onChange={(e) => setType(e.target.value as GeoFenceType)}
            >
              {FENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="zone-color">
              Color <span className={styles.optional}>(optional)</span>
            </label>
            <div className={styles.colorRow}>
              <input
                id="zone-color"
                type="color"
                className={styles.colorPicker}
                value={color || "#3b82f6"}
                onChange={(e) => setColor(e.target.value)}
              />
              {color && (
                <button type="button" className={styles.clearColor} onClick={() => setColor("")}>
                  Use default
                </button>
              )}
            </div>
          </div>
          <div className={styles.meta}>
            <span className={styles.vertexCount}>{polygon.length} vertices</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={!name.trim()}>
              Create Zone
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
