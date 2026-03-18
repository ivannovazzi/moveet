import { useState, useCallback } from "react";
import type { Fleet } from "@/types";
import { Button, SquaredButton } from "@/components/Inputs";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import styles from "./Fleets.module.css";
import { TextField, Input } from "react-aria-components";

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
    <>
      <PanelHeader
        title="Fleets"
        subtitle={
          fleets.length === 0
            ? "Organize vehicles into reusable groups."
            : `${fleets.length} fleet ${fleets.length === 1 ? "group" : "groups"} available`
        }
        badge={<PanelBadge>{fleets.length}</PanelBadge>}
      />

      <PanelBody className={styles.body}>
        {fleets.length < 10 ? (
          <div className={styles.controlRow}>
            <Button className={styles.addButton} onClick={() => setIsAdding(true)} type="button">
              + New
            </Button>
          </div>
        ) : null}
        {fleets.length === 0 && !isAdding ? (
          <PanelEmptyState>No fleets defined</PanelEmptyState>
        ) : null}

        <div className={styles.fleetList}>
          {fleets.map((fleet) => (
            <div key={fleet.id} className={styles.fleet}>
              <span className={styles.colorDot} style={{ backgroundColor: fleet.color }} />
              <span className={styles.fleetName}>{fleet.name}</span>
              <span className={styles.fleetCount}>{fleet.vehicleIds.length}</span>
              {fleet.source === "external" ? (
                <PanelBadge className={styles.externalBadge} tone="neutral">
                  ext
                </PanelBadge>
              ) : (
                <SquaredButton
                  className={styles.deleteButton}
                  icon={<span aria-hidden="true">×</span>}
                  variant="ghost"
                  tone="danger"
                  aria-label="Delete fleet"
                  title="Delete fleet"
                  onClick={() => onDeleteFleet(fleet.id)}
                />
              )}
            </div>
          ))}
        </div>

        {isAdding ? (
          <TextField value={newName} onChange={setNewName} aria-label="New fleet name" autoFocus>
            <Input
              className={styles.newFleetInput}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!newName.trim()) setIsAdding(false);
              }}
              placeholder="Fleet name..."
            />
          </TextField>
        ) : null}
      </PanelBody>
    </>
  );
}
