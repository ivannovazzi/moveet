# Dispatch UX Redesign: Integrated Vehicle List with State Machine

**Date:** 2026-03-14
**Status:** Approved
**Branch:** feat/multi-stop-routing

## Problem

The current multi-stop dispatch UI is confusing:

1. **Two disconnected vehicle lists** — the sidebar has a full vehicle list; the dispatch panel has a second mini vehicle picker with checkboxes. Users must mentally switch contexts.
2. **Cramped overlay panel** — the dispatch panel is a small bottom-right overlay trying to fit mode toggle, vehicle picker, assignment list (expandable waypoints), done button, dispatch button, results (expandable legs), and errors.
3. **No step-based guidance** — everything is visible simultaneously. Users have no sense of "what do I do next?"
4. **"Selected" means three different things** — vehicle selection (blue highlight for route viewing), `selectedForDispatch` (checkboxes), and `assignments` (vehicles with waypoints).
5. **Overlapping context menu options** — "Find Directions To Here" (all vehicles), "Send selected vehicle here" (left-panel-selected), and "Add waypoint here" (dispatch-panel-selected) feel random.

## Solution

Merge dispatch into the existing vehicle list sidebar. Dispatch becomes a **mode** of the vehicle list, not a separate panel. A state machine governs what the sidebar, map, and footer show.

## State Machine

```
BROWSE ──→ SELECT ──→ ROUTE ──→ DISPATCH ──→ RESULTS
  ↑           ↑         │          │            │
  └───────────┴─────────←┘          └──→ ROUTE ←─┘
```

The state is **derived**, not stored explicitly. It is computed from existing state:

| Condition | State |
|-----------|-------|
| `!dispatchMode` | BROWSE |
| `dispatchMode && selectedForDispatch.length === 0` | SELECT |
| `dispatchMode && selectedForDispatch.length > 0 && !dispatching && results.length === 0` | ROUTE |
| `dispatching` | DISPATCH |
| `!dispatching && results.length > 0` | RESULTS |

---

## State 1: BROWSE (default)

### Sidebar
- Normal vehicle list: search, filter, hover, select, fleet dropdown
- "Dispatch" toggle button at top (inactive, subtle)
- Clicking a vehicle row selects it (blue highlight, shows route on map)

### Map
- Vehicles rendered as dots (canvas layer)
- Selected vehicle: blue route polyline + distance label
- Hovered vehicle: orange route polyline
- Right-click: context menu (Find Directions, Find Road, Send Vehicle)
- Left-click on empty space: deselects everything
- Cursor: `default`

### Footer
Hidden.

### Transitions
| Trigger | Next State |
|---------|-----------|
| Click "Dispatch" toggle | SELECT |

---

## State 2: SELECT

### Sidebar
- Vehicle rows show **checkbox** on the left (replaces fleet dropdown)
- Clicking a row toggles the checkbox (not the old select behavior)
- Hover still works (orange route preview on map)
- Search/filter still works
- "All / None" buttons at top of list
- "Dispatch" toggle button is active (blue)

### Map
- Vehicles rendered normally
- Hover preview works (orange polyline)
- Map clicks do nothing
- Checked vehicles get a subtle ring around their dot
- Right-click: reduced context menu (only "Find Road")
- Cursor: `default`

### Footer
Sticky bar at bottom of sidebar:
- `"Select vehicles to dispatch"` when 0 checked
- `"3 selected — click map to add stops"` when >= 1 checked
- [Clear] button → exits back to BROWSE

### Transitions
| Trigger | Next State |
|---------|-----------|
| Check >= 1 vehicle | ROUTE (automatic) |
| Click "Dispatch" toggle off | BROWSE |
| Click [Clear] | BROWSE |

---

## State 3: ROUTE

### Sidebar
- Same as SELECT (checkboxes visible, checked vehicles highlighted)
- Checked vehicles with waypoints show inline badge: `"2 stops"`
- Clicking badge expands inline waypoint list under vehicle row (numbered, with x remove buttons)
- Unchecking a vehicle with waypoints removes its assignment
- Hover still works for route preview

### Map
- **Cursor: `crosshair`**
- Clicking map adds waypoint for all checked vehicles
- PendingDispatch layer: numbered circle markers (1, 2, 3), dashed connecting lines between waypoints
- Checked vehicles with no waypoints: subtle ring on dot
- Right-click: context menu shows "Add waypoint here"
- Hover preview still works

### Footer
- `"3 vehicles, 2 stops"` — counts update live
- [Dispatch] button (primary, blue) — enabled when >= 1 assignment with >= 1 waypoint
- [Clear] button — clears all waypoints and unchecks vehicles → SELECT

### Transitions
| Trigger | Next State |
|---------|-----------|
| Click [Dispatch] | DISPATCH |
| Uncheck all vehicles | SELECT |
| Click "Dispatch" toggle off | BROWSE (clears everything) |
| Remove all waypoints | stays in ROUTE (footer shows hint) |

---

## State 4: DISPATCH (transient)

### Sidebar
- Vehicle list dimmed / non-interactive (pointer-events: none, opacity: 0.6)
- Checkboxes and badges remain visible but frozen

### Map
- PendingDispatch markers remain visible
- Cursor: `wait`
- Map clicks disabled
- Optional: pulse animation on waypoint markers

### Footer
- `"Dispatching 3 vehicles..."` with spinner
- No interactive buttons

### Transitions
| Trigger | Next State |
|---------|-----------|
| API resolves (success or error) | RESULTS |

---

## State 5: RESULTS

### Sidebar
- Checkboxes hidden
- Each dispatched vehicle row shows inline result badge:
  - Green: `"ETA 120s"` for success
  - Red: `"No route"` for error
  - Multi-stop: `"3 stops, 12.4 km"` (clickable to expand legs)
- Non-dispatched vehicles show normally
- Hover still works (now shows computed route from Direction, not pending markers)

### Map
- PendingDispatch markers removed
- Direction polylines appear for successful dispatches
- Waypoint progress dots on multi-stop routes (WaypointMarkers in Direction.tsx)
- Failed vehicles: no route shown
- Cursor: `default`
- Map clicks: back to normal (deselect)

### Footer
- Summary: `"2 dispatched, 1 failed"`
- [Done] button → BROWSE (clears results, exits dispatch)
- [Retry Failed] button (if failures) → ROUTE (re-checks failed vehicles with their waypoints)

### Transitions
| Trigger | Next State |
|---------|-----------|
| Click [Done] | BROWSE |
| Click [Retry Failed] | ROUTE |

---

## What Gets Deleted

- `Controls/BatchDispatch.tsx` — replaced by dispatch mode in Vehicles.tsx
- `Controls/BatchDispatch.module.css` — all styles
- `Controls/__tests__/BatchDispatch.test.tsx` — rewritten as dispatch mode tests
- `App.module.css` `.dispatchPanel*` styles — no separate panel
- ControlPanel "dispatch" toggle button — moves into vehicle list header
- `isDispatchPanelOpen` state in App.tsx — no panel to open

## What Gets Modified

- `Controls/Vehicles.tsx` — gains dispatch mode: checkboxes, waypoint badges, result badges, footer
- `Controls/Vehicles.module.css` — new styles for checkbox, badge, footer
- `App.tsx` — dispatch state management simplified, no separate panel rendering
- `Controls/Controls.tsx` — remove dispatch panel toggle button
- `Map/PendingDispatch.tsx` — no changes (already works with assignments)
- `Map/Direction.tsx` — no changes (already shows waypoint progress)
- Context menu in App.tsx — simplify: remove "Add waypoint here" (map click covers it), keep "Find Road" and "Send Vehicle"

## What Gets Created

- `Controls/DispatchFooter.tsx` — the sticky footer bar (state-aware)
- `Controls/DispatchFooter.module.css` — footer styles
- `hooks/useDispatchState.ts` — derived state computation hook, returns current state enum + helpers

## Component Structure (after)

```
App.tsx
├── ControlPanel (top bar — no dispatch button)
├── Sidebar (left)
│   ├── Fleets
│   ├── DispatchToggle (new, top of vehicle list)
│   ├── Vehicles (with conditional checkboxes + badges)
│   └── DispatchFooter (sticky bottom, state-aware)
├── Map
│   ├── VehiclesLayer (canvas)
│   ├── PendingDispatch (SVG markers — unchanged)
│   ├── Direction (SVG routes — unchanged)
│   └── ... (roads, POIs, heatzones)
└── ContextMenu (simplified)
```

## Implementation Order

1. **useDispatchState hook** — derive state from existing signals
2. **Vehicles.tsx** — add checkbox mode, waypoint badges, result badges
3. **DispatchFooter** — new component, sticky footer bar
4. **App.tsx** — remove BatchDispatch panel, wire dispatch state to sidebar + map
5. **Map cursor/interaction** — crosshair in ROUTE, disabled in DISPATCH
6. **Context menu** — simplify options per state
7. **Delete** BatchDispatch.tsx, clean up Controls.tsx
8. **Tests** — rewrite dispatch tests for new integrated UX
