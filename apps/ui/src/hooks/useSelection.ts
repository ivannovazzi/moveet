import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { POI, Road } from "@/types";
import { isRoad } from "@/utils/typeGuards";

export type SelectionKind = "vehicle" | "road" | "poi";

/** The single source of truth for what is selected on the map/panels. */
export interface Selection {
  kind: SelectionKind;
  id: string;
}

/**
 * Stable id for a road/POI selection. POIs carry a server id; roads don't —
 * a road's (unique, aggregated-by-name) name doubles as its id.
 */
export function selectionIdFor(item: Road | POI): string {
  return isRoad(item) ? item.name : item.id;
}

interface SelectionState {
  selection: Selection;
  /**
   * Object payload for road/POI selections. Roads and POIs are selected as
   * whole objects (search commit, map pick, find-road) and consumers render
   * the object directly; vehicles resolve by id against the live vehicle list.
   */
  item: Road | POI | null;
}

export interface SelectionApi {
  selection: Selection | null;
  /** Selected Road/POI object (null when a vehicle or nothing is selected). */
  selectedItem: Road | POI | null;
  /** Select by kind+id. Re-selecting the same kind+id toggles it off; selecting
   * anything else replaces the previous selection of any kind. */
  select: (kind: SelectionKind, id: string) => void;
  /** Select a road/POI object. Always replaces (search/find-road are "show me
   * this", not a toggle). */
  selectItem: (item: Road | POI) => void;
  clear: () => void;
}

/**
 * Unified selection model: exactly one of {vehicle, road, poi} can be selected
 * at a time — mutual exclusion by construction (single state cell), replacing
 * the old split between `filters.selected` (vehicles) and `selectedItem`
 * (roads/POIs) that App had to hand-reconcile.
 */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<SelectionState | null>(null);

  const select = useCallback((kind: SelectionKind, id: string) => {
    setState((prev) =>
      prev && prev.selection.kind === kind && prev.selection.id === id
        ? null
        : { selection: { kind, id }, item: null }
    );
  }, []);

  const selectItem = useCallback((item: Road | POI) => {
    setState({
      selection: { kind: isRoad(item) ? "road" : "poi", id: selectionIdFor(item) },
      item,
    });
  }, []);

  const clear = useCallback(() => setState(null), []);

  return useMemo(
    () => ({
      selection: state?.selection ?? null,
      selectedItem: state?.item ?? null,
      select,
      selectItem,
      clear,
    }),
    [state, select, selectItem, clear]
  );
}

// ─── Context ─────────────────────────────────────────────────────────
// App owns the state (it also feeds pieces into sibling hooks) and provides
// it here so deep consumers (Inspector, panels) read selection without App
// drilling and hand-reconciling props.

export const SelectionContext = createContext<SelectionApi | null>(null);

export function useSelectionContext(): SelectionApi {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useSelectionContext must be used within a SelectionContext.Provider");
  }
  return ctx;
}
