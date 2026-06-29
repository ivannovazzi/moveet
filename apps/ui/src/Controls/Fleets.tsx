import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Fleet, Vehicle } from "@/types";
import { Button, SquaredButton } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelErrorState,
  PanelHeader,
} from "./PanelPrimitives";

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
            <Button size="sm" onClick={() => setIsAdding(true)} type="button">
              + New
            </Button>
          </div>
        ) : null}
        {fleets.length === 0 && !isAdding && !error ? (
          <PanelEmptyState>No fleets defined</PanelEmptyState>
        ) : null}

        <div className="flex flex-col gap-2">
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
              <div
                key={fleet.id}
                className="flex flex-col overflow-hidden rounded-md border border-white/5 bg-white/[0.03] transition-colors hover:border-white/10"
              >
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]",
                    isExpanded && "bg-white/[0.06]"
                  )}
                  onClick={() => toggleExpanded(fleet.id)}
                  aria-expanded={isExpanded}
                  aria-label={`${fleet.name}, ${fleet.vehicleIds.length} vehicles`}
                >
                  <span
                    className="size-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: fleet.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {fleet.name}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {fleet.vehicleIds.length}
                  </span>
                  {fleet.source === "external" ? (
                    <PanelBadge className="uppercase" tone="neutral">
                      ext
                    </PanelBadge>
                  ) : (
                    <SquaredButton
                      className="flex-shrink-0"
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
                  <div className="flex flex-col gap-3 border-t border-border/60 p-3">
                    {memberVehicles.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <span className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Assigned
                        </span>
                        {memberVehicles.map((v) => (
                          <div
                            key={v.id}
                            className="flex items-center justify-between rounded-sm px-2 py-1 transition-colors hover:bg-white/[0.06]"
                          >
                            <span className="min-w-0 truncate text-[13px] text-foreground">
                              {v.name}
                            </span>
                            <button
                              type="button"
                              className="flex size-[22px] flex-shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error"
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
                      <span className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                        <span className="py-2 text-xs text-muted-foreground">
                          {vehicleFilter ? "No matches" : "All vehicles assigned"}
                        </span>
                      ) : (
                        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                          {unassignedVehicles.map((v) => (
                            <div
                              key={v.id}
                              className="flex items-center justify-between rounded-sm px-2 py-1 transition-colors hover:bg-white/[0.06]"
                            >
                              <span className="min-w-0 truncate text-[13px] text-foreground">
                                {v.name}
                              </span>
                              <button
                                type="button"
                                className="flex size-[22px] flex-shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-status-ok/30 hover:bg-status-ok/10 hover:text-status-ok"
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
