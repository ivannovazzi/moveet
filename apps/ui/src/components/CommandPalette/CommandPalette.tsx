import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { POI, Road, Vehicle } from "@/types";
import { CarIcon, POI as POIIcon, Road as RoadIcon, Search } from "@/components/Icons";
import { Highlight, score } from "@/SearchBar/fuzzy";
import { cn } from "@/lib/utils";
import type { PaletteAction } from "./types";

/** Per-group result caps — the palette is a shortlist, not a browser. */
const MAX_ACTIONS = 8;
const MAX_ENTITIES_PER_GROUP = 5;

const GROUP_ORDER = ["actions", "vehicles", "roads", "places"] as const;
type GroupId = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<GroupId, string> = {
  actions: "Actions",
  vehicles: "Vehicles",
  roads: "Roads",
  places: "Places",
};

/** A flattened, keyboard-navigable palette row. */
interface Row {
  key: string;
  group: GroupId;
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Matched character offsets within `label`, for highlighting. */
  positions: number[];
  score: number;
  run: () => void;
}

export interface CommandPaletteProps {
  /** Searchable entities. Vehicles come from `useVehicles`, the rest from the data contexts. */
  vehicles: Vehicle[];
  roads: Road[];
  pois: POI[];
  /** Runnable actions, built by `buildCommands` from the app's own handlers. */
  actions: PaletteAction[];
  /** Same handler the vehicle list / map click uses — selection flies the camera. */
  onSelectVehicle: (id: string) => void;
  /** Same handler `SearchBar` uses for a road or POI result. */
  onSelectItem: (item: Road | POI) => void;
}

const byScore = (a: Row, b: Row) => b.score - a.score;

/** True for the platform's palette chord: ⌘K on macOS, Ctrl+K elsewhere. */
function isPaletteChord(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K");
}

/**
 * Cmd/Ctrl+K command palette over entities (vehicles, roads, places) *and*
 * every action the dock exposes, in one grouped, arrow-navigable list.
 *
 * Escape scoping: the only always-on listener is the ⌘K chord. The Escape /
 * arrow / Enter handler is installed on `document` **only while the palette is
 * open** and torn down on close, so it can never swallow Escape from dispatch
 * mode or geofence drawing (both of which own Escape via their own window
 * listeners). While the palette *is* open it is the topmost modal surface, so
 * it stops the event there rather than letting those modes also react.
 */
export default function CommandPalette({
  vehicles,
  roads,
  pois,
  actions,
  onSelectVehicle,
  onSelectItem,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // ── Result rows ──────────────────────────────────────────────────
  // One memo per source so a vehicle tick (which replaces the `vehicles`
  // array a few times a second) doesn't rescan every road and POI.
  const q = query.trim();

  // Actions are the palette's resting state: with an empty query we list them
  // all, so the operator can discover what is reachable.
  const actionRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const action of actions) {
      let positions: number[] = [];
      let rank = 0;
      if (q) {
        const match = score(action.label, q);
        if (match) {
          positions = match.positions;
          rank = match.score;
        } else if (action.keywords && score(action.keywords, q)) {
          rank = 100;
        } else {
          continue;
        }
      }
      out.push({
        key: `action:${action.id}`,
        group: "actions",
        label: action.label,
        hint: action.hint,
        icon: action.icon,
        positions,
        score: rank,
        run: action.run,
      });
    }
    if (!q) return out;
    return out.sort(byScore).slice(0, MAX_ACTIONS);
  }, [actions, q]);

  // Entities are only searched once there's a query — there are thousands of
  // roads and listing them unprompted would bury the actions.
  const vehicleRows = useMemo<Row[]>(() => {
    if (!q) return [];
    const out: Row[] = [];
    for (const vehicle of vehicles) {
      const name = vehicle.name || vehicle.id;
      const match = score(name, q) ?? (score(vehicle.id, q) ? { score: 100, positions: [] } : null);
      if (!match) continue;
      out.push({
        key: `vehicle:${vehicle.id}`,
        group: "vehicles",
        label: name,
        hint: `${Math.round(vehicle.speed)} km/h`,
        icon: <CarIcon />,
        positions: match.positions,
        score: match.score,
        run: () => onSelectVehicle(vehicle.id),
      });
    }
    return out.sort(byScore).slice(0, MAX_ENTITIES_PER_GROUP);
  }, [vehicles, q, onSelectVehicle]);

  const roadRows = useMemo<Row[]>(() => {
    if (!q) return [];
    const out: Row[] = [];
    for (const road of roads) {
      if (!road.name) continue;
      const match = score(road.name, q);
      if (!match) continue;
      out.push({
        key: `road:${road.name}`,
        group: "roads",
        label: road.name,
        icon: <RoadIcon />,
        positions: match.positions,
        score: match.score,
        run: () => onSelectItem(road),
      });
    }
    return out.sort(byScore).slice(0, MAX_ENTITIES_PER_GROUP);
  }, [roads, q, onSelectItem]);

  const placeRows = useMemo<Row[]>(() => {
    if (!q) return [];
    const out: Row[] = [];
    for (const poi of pois) {
      if (!poi.name) continue;
      const match = score(poi.name, q);
      if (!match) continue;
      out.push({
        key: `poi:${poi.name}-${poi.coordinates.join(",")}`,
        group: "places",
        label: poi.name,
        icon: <POIIcon />,
        positions: match.positions,
        score: match.score,
        run: () => onSelectItem(poi),
      });
    }
    return out.sort(byScore).slice(0, MAX_ENTITIES_PER_GROUP);
  }, [pois, q, onSelectItem]);

  const rows = useMemo(
    () => [...actionRows, ...vehicleRows, ...roadRows, ...placeRows],
    [actionRows, vehicleRows, roadRows, placeRows]
  );

  // Keyboard handling reads the latest rows/highlight through refs so the
  // document listener is installed once per open, not once per keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;

  // Reset the highlight when the query changes, and clamp it if the result
  // count shrinks. Deliberately NOT keyed on `rows` identity: live vehicle
  // ticks rebuild that array and would otherwise yank the highlight back to
  // the top mid-navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `query` is the trigger, not an input.
  useEffect(() => setActiveIdx(0), [query]);
  useEffect(() => setActiveIdx((i) => (i >= rows.length ? 0 : i)), [rows.length]);

  const runRow = useCallback((row: Row | undefined) => {
    if (!row) return;
    setOpen(false);
    row.run();
  }, []);

  // ── ⌘K / Ctrl+K: the only always-on listener ─────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isPaletteChord(e)) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Navigation + Escape, installed ONLY while open ───────────────
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      const rows = rowsRef.current;
      const move = (next: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (rows.length) setActiveIdx(((next % rows.length) + rows.length) % rows.length);
      };

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          // The palette is the topmost modal while open, so it consumes
          // Escape here instead of letting dispatch mode / geofence drawing
          // (window-level listeners) also unwind on the same press.
          e.stopPropagation();
          setOpen(false);
          break;
        case "ArrowDown":
          move(activeIdxRef.current + 1);
          break;
        case "ArrowUp":
          move(activeIdxRef.current - 1);
          break;
        case "Home":
          move(0);
          break;
        case "End":
          move(rows.length - 1);
          break;
        case "Tab":
          // The input is the only focusable element inside the palette;
          // trapping Tab keeps focus (and therefore typing) where it belongs.
          e.preventDefault();
          break;
        case "Enter": {
          const row = rows[activeIdxRef.current];
          if (!row) return;
          e.preventDefault();
          e.stopPropagation();
          runRow(row);
          break;
        }
      }
    };

    // Capture phase: runs before the window-level `keydown` listeners owned by
    // useDispatchShortcuts / GeofenceDrawTool, so `stopPropagation` above
    // actually keeps Escape from reaching them while the palette is open.
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, runRow]);

  // ── Focus management ─────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus();
      return;
    }
    setQuery("");
    setActiveIdx(0);
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, [open]);

  // Keep the highlighted row visible during arrow navigation.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`palette-row-${activeIdx}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIdx]);

  if (!open) return null;

  let rowIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center">
      {/* Click-out backdrop. Escape is the keyboard equivalent, so it carries
          no keyboard handler of its own. */}
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-[2px]"
        onMouseDown={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn(
          "relative mt-[12vh] flex w-[min(640px,calc(100%-2rem))] flex-col overflow-hidden",
          "origin-top animate-scale-in rounded-lg border border-border surface-glass",
          "shadow-floating backdrop-blur-md"
        )}
      >
        {/* ── Input row ── */}
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            role="combobox"
            className="h-full w-full bg-transparent text-sm text-foreground caret-accent outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vehicles, roads, places and actions…"
            aria-label="Search vehicles, roads, places and actions"
            aria-expanded
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            aria-activedescendant={rows.length ? `palette-row-${activeIdx}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* ── Results ── */}
        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(420px,60vh)] overflow-y-auto p-2"
        >
          {rows.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</p>
          )}
          {GROUP_ORDER.map((group) => {
            const groupRows = rows.filter((r) => r.group === group);
            if (!groupRows.length) return null;
            const headingId = `palette-group-${group}`;
            return (
              <div key={group} role="group" aria-labelledby={headingId}>
                <div
                  id={headingId}
                  className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {GROUP_LABEL[group]}
                </div>
                {groupRows.map((row) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const active = index === activeIdx;
                  return (
                    // Rows are listbox options: the keyboard path goes through
                    // the input's handler, the mouse path through onMouseDown.
                    <div
                      key={row.key}
                      id={`palette-row-${index}`}
                      role="option"
                      aria-selected={active}
                      className={cn(
                        "flex min-h-9 cursor-pointer select-none items-center gap-3 rounded-sm px-2 py-2",
                        "text-foreground transition-colors duration-fast ease-standard",
                        active && "bg-accent/10"
                      )}
                      onMouseDown={(e) => {
                        // Keep focus in the input so Escape stays scoped here.
                        e.preventDefault();
                        runRow(row);
                      }}
                      onMouseEnter={() => setActiveIdx(index)}
                    >
                      <span
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5",
                          active && "text-accent"
                        )}
                      >
                        {row.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm leading-tight text-muted-foreground">
                        <Highlight text={row.label} positions={row.positions} />
                      </span>
                      {row.hint && (
                        <span
                          className={cn(
                            "shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground opacity-70",
                            active && "text-accent opacity-100"
                          )}
                        >
                          {row.hint}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Footer hints ── */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>↑↓ Navigate</span>
          <span>↵ Run</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
