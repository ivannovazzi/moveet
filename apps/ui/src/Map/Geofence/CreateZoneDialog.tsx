import { useState } from "react";
import type { CreateGeoFenceRequest, GeoFenceType } from "@moveet/shared-types";
import styles from "./CreateZoneDialog.module.css";

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d1x = p2[0] - p1[0],
    d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0],
    d2y = p4[1] - p3[1];
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / cross;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / cross;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

function isSelfIntersecting(vertices: [number, number][]): boolean {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // skip adjacent closing edge
      if (
        segmentsIntersect(
          vertices[i],
          vertices[(i + 1) % n],
          vertices[j],
          vertices[(j + 1) % n],
        )
      )
        return true;
    }
  }
  return false;
}

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
  const [validationError, setValidationError] = useState<string | null>(null);

  if (polygon === null) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!name.trim()) return;

    if (polygon.length < 3) {
      setValidationError("Polygon must have at least 3 vertices.");
      return;
    }

    if (isSelfIntersecting(polygon)) {
      setValidationError("Polygon edges must not cross each other.");
      return;
    }

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
    setValidationError(null);
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
          {validationError && (
            <p className={styles.validationError} role="alert">
              {validationError}
            </p>
          )}
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
