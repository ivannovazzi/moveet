import { useState, useCallback } from "react";
import type { Fleet } from "@/types";
import styles from "./Fleets.module.css";

interface FleetsProps {
  fleets: Fleet[];
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (id: string) => Promise<void>;
}

export default function Fleets({ fleets, onCreateFleet, onDeleteFleet }: FleetsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const handleSubmit = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await onCreateFleet(trimmed);
    setNewName("");
    setIsAdding(false);
  }, [newName, onCreateFleet]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
      if (e.key === "Escape") {
        setIsAdding(false);
        setNewName("");
      }
    },
    [handleSubmit]
  );

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>Fleets</span>
        {fleets.length < 10 && (
          <button className={styles.addButton} onClick={() => setIsAdding(true)} type="button">
            + New
          </button>
        )}
      </div>

      {fleets.length === 0 && !isAdding && <div className={styles.empty}>No fleets defined</div>}

      <div className={styles.fleetList}>
        {fleets.map((fleet) => (
          <div key={fleet.id} className={styles.fleet}>
            <span className={styles.colorDot} style={{ backgroundColor: fleet.color }} />
            <span className={styles.fleetName}>{fleet.name}</span>
            <span className={styles.fleetCount}>{fleet.vehicleIds.length}</span>
            {fleet.source === "external" ? (
              <span className={styles.lockIcon} title="External fleet (read-only)">
                ext
              </span>
            ) : (
              <button
                className={styles.deleteButton}
                onClick={() => onDeleteFleet(fleet.id)}
                title="Delete fleet"
                type="button"
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      {isAdding && (
        <input
          className={styles.newFleetInput}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!newName.trim()) setIsAdding(false);
          }}
          placeholder="Fleet name..."
          autoFocus
        />
      )}
    </div>
  );
}
