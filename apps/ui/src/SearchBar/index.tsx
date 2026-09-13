import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Command, CommandItem, CommandList } from "cmdk";
import type { POI, Road, Vehicle } from "@/types";
import { Directions, POI as POIIcon, Road as RoadIcon } from "@/components/Icons";
import { isMappablePoi } from "@/Map/POI/categories";
import { Button } from "@/components/Inputs";
import { useRoads } from "@/hooks/useRoads";
import { usePois } from "@/hooks/usePois";
import { isRoad } from "@/utils/typeGuards";
import { cn } from "@/lib/utils";
import { Highlight, score } from "./fuzzy";

/** Per-group result caps, and the overall cap across all groups. */
const MAX_RESULTS = 12;
const MAX_PER_GROUP = 6;

// ── Fuzzy search ──────────────────────────────────────────────────────────────
// `score` / `Highlight` live in ./fuzzy so the Cmd+K command palette ranks and
// highlights entity results exactly the way this bar does.

const GROUP_ORDER = ["vehicles", "roads", "places"] as const;
type GroupId = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<GroupId, string> = {
  vehicles: "Vehicles",
  roads: "Roads",
  places: "Places",
};

/** A flattened, keyboard-navigable result row. */
interface Row {
  key: string;
  group: GroupId;
  item: Road | POI | Vehicle;
  score: number;
  positions: number[];
}

function isVehicle(item: Road | POI | Vehicle): item is Vehicle {
  return typeof (item as Vehicle).speed === "number" && "heading" in item;
}

function buildRows(vehicles: Vehicle[], roads: Road[], pois: POI[], query: string): Row[] {
  if (!query.trim()) return [];

  const vehicleRows: Row[] = [];
  for (const v of vehicles) {
    const name = v.name || v.id;
    const m = score(name, query);
    if (!m) continue;
    vehicleRows.push({
      key: `vehicle:${v.id}`,
      group: "vehicles",
      item: v,
      score: m.score,
      positions: m.positions,
    });
  }

  const roadRows: Row[] = [];
  for (const r of roads) {
    if (!r.name) continue;
    const m = score(r.name, query);
    if (!m) continue;
    roadRows.push({
      key: `road:${r.name}`,
      group: "roads",
      item: r,
      score: m.score,
      positions: m.positions,
    });
  }

  const placeRows: Row[] = [];
  for (const p of pois) {
    // Only POIs the map is willing to draw: surfacing a result that selects an
    // invisible marker is worse than not offering it.
    if (!isMappablePoi(p)) continue;
    const m = score(p.name, query);
    if (!m) continue;
    placeRows.push({
      key: `poi:${p.name}-${p.coordinates.join(",")}`,
      group: "places",
      item: p,
      score: m.score,
      positions: m.positions,
    });
  }

  const byScore = (a: Row, b: Row) => b.score - a.score;
  const groups = [
    vehicleRows.sort(byScore).slice(0, MAX_PER_GROUP),
    roadRows.sort(byScore).slice(0, MAX_PER_GROUP),
    placeRows.sort(byScore).slice(0, MAX_PER_GROUP),
  ];

  // Interleave in group order (Vehicles, Roads, Places), capped overall.
  return groups.flat().slice(0, MAX_RESULTS);
}

// ── SearchBar ─────────────────────────────────────────────────────────────────

interface SearchBarProps {
  selectedItem: Road | POI | null;
  onDestinationClick: () => void;
  onItemSelect: (item: Road | POI) => void;
  onItemUnselect: () => void;
  vehicles: Vehicle[];
  onSelectVehicle: (id: string) => void;
}

export default function SearchBar({
  selectedItem,
  onDestinationClick,
  onItemSelect,
  onItemUnselect,
  vehicles,
  onSelectVehicle,
}: SearchBarProps) {
  const { roads } = useRoads();
  const { pois } = usePois();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [focused, setFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => buildRows(vehicles, roads, pois, query),
    [vehicles, roads, pois, query]
  );
  const q = query.trim();
  const showEmptyState = open && q.length > 0 && rows.length === 0;
  const showResults = open && (rows.length > 0 || showEmptyState);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on every new result set, not just a length change.
  useEffect(() => setActiveIdx(0), [rows]);

  const commit = useCallback(
    (row: Row) => {
      if (isVehicle(row.item)) {
        onSelectVehicle(row.item.id);
        setQuery(row.item.name ?? row.item.id);
      } else {
        onItemSelect(row.item);
        setQuery(row.item.name ?? "");
      }
      setOpen(false);
      inputRef.current?.blur();
    },
    [onItemSelect, onSelectVehicle]
  );

  const clear = useCallback(() => {
    setQuery("");
    setOpen(false);
    onItemUnselect();
    inputRef.current?.focus();
  }, [onItemUnselect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (!query) inputRef.current?.blur();
        return;
      }
      if (!showResults || rows.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Stop cmdk's Command root from also moving its internal selection —
        // navigation is driven solely by `activeIdx`.
        e.stopPropagation();
        setActiveIdx((i) => (i + 1) % rows.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => (i - 1 + rows.length) % rows.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const r = rows[activeIdx];
        if (r) commit(r);
      }
    },
    [showResults, rows, activeIdx, commit, query]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  let rowIndex = -1;

  return (
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-auto absolute left-1/2 top-3 z-50 flex w-[min(640px,calc(100%-72px))]",
        "-translate-x-1/2 flex-col overflow-hidden border border-border surface-glass glass-frost shadow-floating",
        "rounded-lg"
      )}
      role="combobox"
      aria-expanded={showResults}
      aria-haspopup="listbox"
    >
      <Command
        shouldFilter={false}
        className="flex flex-col bg-transparent text-popover-foreground"
      >
        {/* ── Input row ── */}
        <div className={cn("flex h-12 items-stretch", showResults && "border-b border-border")}>
          <div className="relative flex min-w-0 flex-1 items-center">
            <svg
              className="pointer-events-none absolute left-4 size-4 shrink-0 text-muted-foreground"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M10 10L14 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              className="h-full w-full bg-transparent pl-11 pr-7 text-sm text-foreground caret-accent outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                setFocused(true);
                if (query) setOpen(true);
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="Search vehicles, roads and places…"
              aria-label="Search"
              aria-autocomplete="list"
              aria-controls="search-results"
              aria-activedescendant={
                showResults && rows[activeIdx] ? `result-${activeIdx}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button
                className="absolute right-4 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 p-0 text-muted-foreground transition-colors hover:bg-foreground/20 hover:text-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  clear();
                }}
                tabIndex={-1}
                aria-label="Clear"
              >
                <svg className="size-2 fill-none" viewBox="0 0 12 12">
                  <path
                    d="M2 2l8 8M10 2l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : (
              !focused && (
                <span
                  className={cn(
                    "pointer-events-none absolute right-4 flex shrink-0 items-center rounded border border-border",
                    "bg-foreground/[0.04] px-1 py-0.5 text-micro font-semibold text-muted-foreground"
                  )}
                  aria-hidden="true"
                >
                  ⌘K
                </span>
              )
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            onClick={onDestinationClick}
            isDisabled={!selectedItem}
            className="h-full w-14 shrink-0 rounded-none border-0 border-l border-border text-muted-foreground hover:text-foreground [&_svg]:size-[18px]"
            aria-label="Get directions"
            title="Get directions to the selected place"
          >
            <Directions />
          </Button>
        </div>

        {/* ── Results ── */}
        {showResults && (
          <CommandList
            id="search-results"
            className="max-h-[380px] origin-top animate-scale-in overflow-y-auto p-2"
            aria-label="Search results"
          >
            {showEmptyState ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No matches for “{q}”
              </p>
            ) : (
              GROUP_ORDER.map((group) => {
                const groupRows = rows.filter((r) => r.group === group);
                if (!groupRows.length) return null;
                const headingId = `search-group-${group}`;
                return (
                  <div key={group} role="group" aria-labelledby={headingId}>
                    <div
                      id={headingId}
                      className="px-4 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {GROUP_LABEL[group]}
                    </div>
                    {groupRows.map((r) => {
                      rowIndex += 1;
                      const i = rowIndex;
                      const item = r.item;
                      const vehicle = isVehicle(item) ? item : null;
                      const road = !isVehicle(item) && isRoad(item);
                      return (
                        <CommandItem
                          key={r.key}
                          id={`result-${i}`}
                          value={`${r.item.name ?? ""}-${i}`}
                          className={cn(
                            "flex h-9 min-h-9 cursor-pointer select-none items-center gap-3 rounded-sm px-4 text-foreground transition-colors duration-fast ease-standard",
                            i === activeIdx && "bg-accent/10"
                          )}
                          aria-selected={i === activeIdx}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commit(r);
                          }}
                          onMouseEnter={() => setActiveIdx(i)}
                          onSelect={() => commit(r)}
                        >
                          {vehicle ? (
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                vehicle.speed > 0 ? "bg-status-ok" : "bg-muted-foreground"
                              )}
                            />
                          ) : (
                            <span
                              className={cn(
                                "flex size-3.5 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-fast ease-standard [&_svg]:size-3.5",
                                i === activeIdx && "text-accent"
                              )}
                            >
                              {road ? <RoadIcon /> : <POIIcon />}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-body leading-tight text-muted-foreground">
                            <Highlight text={r.item.name ?? ""} positions={r.positions} />
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-micro font-semibold uppercase tracking-wider text-muted-foreground opacity-70",
                              i === activeIdx && "text-accent opacity-100"
                            )}
                          >
                            {vehicle
                              ? `${Math.round(vehicle.speed)} km/h`
                              : road
                                ? "road"
                                : "place"}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </div>
                );
              })
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
}
