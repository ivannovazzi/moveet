import { useState, useCallback, useMemo } from "react";
import classNames from "classnames";
import type { Fleet, Vehicle } from "@/types";
import { Button, SquaredButton } from "@/components/Inputs";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import styles from "./Fleets.module.css";
import { TextField, Input } from "react-aria-components";

interface FleetsProps {
  fleets: Fleet[];
  vehicles: Vehicle[];
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (id: string) => Promise<void>;
  onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
}

export default function Fleets({
  fleets,
  vehicles,
  onCreateFleet,
  onDeleteFleet,
  onAssignVehicle,
  onUnassignVehicle,
}: FleetsProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [expandedFleetId, setExpandedFleetId] = useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState("");

  /** Set of all vehicle IDs currently assigned to any fleet */
  const assignedVehicleIds = useMemo(() => {
    const set = new Set<string>();
    for (const fleet of fleets) {
      for (const vid of fleet.vehicleIds) {
        set.add(vid);
      }
    }
    return set;
  }, [fleets]);

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

  const toggleExpanded = useCallback((fleetId: string) => {
    setExpandedFleetId((prev) => (prev === fleetId ? null : fleetId));
    setVehicleFilter("");
  }, []);

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
          {fleets.map((fleet) => {
            const isExpanded = expandedFleetId === fleet.id;
            const memberVehicles = vehicles.filter((v) => fleet.vehicleIds.includes(v.id));
            const filterLower = vehicleFilter.toLowerCase();
            const unassignedVehicles = vehicles.filter(
              (v) =>
                !assignedVehicleIds.has(v.id) &&
                (!filterLower || v.name.toLowerCase().includes(filterLower))
            );

            return (
              <div key={fleet.id} className={styles.fleetCard}>
                <button
                  type="button"
                  className={classNames(styles.fleet, { [styles.fleetExpanded]: isExpanded })}
                  onClick={() => toggleExpanded(fleet.id)}
                  aria-expanded={isExpanded}
                  aria-label={`${fleet.name}, ${fleet.vehicleIds.length} vehicles`}
                >
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
                      icon={<span aria-hidden="true">&times;</span>}
                      variant="ghost"
                      tone="danger"
                      aria-label="Delete fleet"
                      title="Delete fleet"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFleet(fleet.id);
                      }}
                    />
                  )}
                </button>

                {isExpanded ? (
                  <div className={styles.vehicleSection}>
                    {memberVehicles.length > 0 ? (
                      <div className={styles.memberList}>
                        <span className={styles.sectionLabel}>Assigned</span>
                        {memberVehicles.map((v) => (
                          <div key={v.id} className={styles.memberRow}>
                            <span className={styles.memberName}>{v.name}</span>
                            <button
                              type="button"
                              className={styles.removeButton}
                              onClick={() => onUnassignVehicle(fleet.id, v.id)}
                              aria-label={`Remove ${v.name}`}
                              title={`Remove ${v.name} from fleet`}
                            >
                              &minus;
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className={styles.addVehicleSection}>
                      <span className={styles.sectionLabel}>Add vehicles</span>
                      {vehicles.length > 6 ? (
                        <input
                          type="text"
                          className={styles.vehicleFilterInput}
                          placeholder="Filter vehicles..."
                          value={vehicleFilter}
                          onChange={(e) => setVehicleFilter(e.target.value)}
                          aria-label="Filter unassigned vehicles"
                        />
                      ) : null}
                      {unassignedVehicles.length === 0 ? (
                        <span className={styles.noVehicles}>
                          {vehicleFilter ? "No matches" : "All vehicles assigned"}
                        </span>
                      ) : (
                        <div className={styles.unassignedList}>
                          {unassignedVehicles.map((v) => (
                            <div key={v.id} className={styles.memberRow}>
                              <span className={styles.memberName}>{v.name}</span>
                              <button
                                type="button"
                                className={styles.assignButton}
                                onClick={() => onAssignVehicle(fleet.id, v.id)}
                                aria-label={`Add ${v.name}`}
                                title={`Add ${v.name} to fleet`}
                              >
                                +
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
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
