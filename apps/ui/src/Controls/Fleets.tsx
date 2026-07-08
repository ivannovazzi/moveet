import { Fragment, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Fleet, Vehicle } from "@/types";
import { Button, SquaredButton } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import { LayersIcon } from "@/components/Icons";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelErrorState,
  PanelHeader,
} from "./PanelPrimitives";
import { LList, LRow, Tag, mono } from "@/Dock/DockPanelKit";

// App focus-ring recipe for the custom (non-primitive) buttons in this panel.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";

interface FleetsProps {
  fleets: Fleet[];
  vehicles: Vehicle[];
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (id: string) => Promise<void>;
  onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  error?: string | null;
}

export default function Fleets({
  fleets,
  vehicles,
  onCreateFleet,
  onDeleteFleet,
  onAssignVehicle,
  onUnassignVehicle,
  error,
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

      <PanelBody className="gap-3">
        {error ? <PanelErrorState>{error}</PanelErrorState> : null}
        {fleets.length < 10 ? (
          <div className="flex justify-end">
            <Button size="sm" variant="default" onClick={() => setIsAdding(true)} type="button">
              + New
            </Button>
          </div>
        ) : null}
        {fleets.length === 0 && !isAdding && !error ? (
          <PanelEmptyState icon={<LayersIcon />}>No fleets defined</PanelEmptyState>
        ) : null}

        <LList className="px-0">
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
              <Fragment key={fleet.id}>
                <LRow
                  tone="idle"
                  className={cn(isExpanded && "bg-foreground/[0.035]")}
                  primary={
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm text-left",
                        FOCUS_RING
                      )}
                      onClick={() => toggleExpanded(fleet.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${fleet.name}, ${fleet.vehicleIds.length} vehicles`}
                    >
                      <span
                        className="size-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: fleet.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{fleet.name}</span>
                    </button>
                  }
                  meta={
                    <>
                      <span className={cn(mono, "text-[11px] text-muted-foreground")}>
                        {fleet.vehicleIds.length}
                      </span>
                      {fleet.source === "external" ? (
                        <Tag tone="idle">ext</Tag>
                      ) : (
                        <SquaredButton
                          className="flex-shrink-0"
                          icon={<span aria-hidden="true">&times;</span>}
                          variant="ghost"
                          tone="danger"
                          aria-label="Delete fleet"
                          title="Delete fleet"
                          onClick={() => onDeleteFleet(fleet.id)}
                        />
                      )}
                    </>
                  }
                />

                {isExpanded ? (
                  <div className="flex flex-col gap-3 border-t border-border-soft px-2 py-2.5">
                    {memberVehicles.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <span className="pb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                          Assigned
                        </span>
                        {memberVehicles.map((v) => (
                          <div
                            key={v.id}
                            className="flex items-center justify-between rounded-sm px-2 py-1 transition-colors duration-fast ease-standard hover:bg-foreground/[0.06]"
                          >
                            <span className="min-w-0 truncate text-[12px] text-foreground">
                              {v.name}
                            </span>
                            <button
                              type="button"
                              className={cn(
                                "flex size-[22px] flex-shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors duration-fast ease-standard hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error",
                                FOCUS_RING
                              )}
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

                    <div className="flex flex-col gap-1">
                      <span className="pb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                        Add vehicles
                      </span>
                      {vehicles.length > 6 ? (
                        <Input
                          type="text"
                          className="h-8 text-sm"
                          placeholder="Filter vehicles..."
                          value={vehicleFilter}
                          onChange={(e) => setVehicleFilter(e.target.value)}
                          aria-label="Filter unassigned vehicles"
                        />
                      ) : null}
                      {unassignedVehicles.length === 0 ? (
                        <span className="py-2 text-[12px] text-muted-foreground">
                          {vehicleFilter ? "No matches" : "All vehicles assigned"}
                        </span>
                      ) : (
                        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                          {unassignedVehicles.map((v) => (
                            <div
                              key={v.id}
                              className="flex items-center justify-between rounded-sm px-2 py-1 transition-colors duration-fast ease-standard hover:bg-foreground/[0.06]"
                            >
                              <span className="min-w-0 truncate text-[12px] text-foreground">
                                {v.name}
                              </span>
                              <button
                                type="button"
                                className={cn(
                                  "flex size-[22px] flex-shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors duration-fast ease-standard hover:border-status-ok/30 hover:bg-status-ok/10 hover:text-status-ok",
                                  FOCUS_RING
                                )}
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
              </Fragment>
            );
          })}
        </LList>

        {isAdding ? (
          <Input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!newName.trim()) setIsAdding(false);
            }}
            placeholder="Fleet name..."
            aria-label="New fleet name"
            autoFocus
          />
        ) : null}
      </PanelBody>
    </>
  );
}
