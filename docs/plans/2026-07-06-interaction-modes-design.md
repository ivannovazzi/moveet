# UI Redesign Phase 2 — Interaction Quality, Modes, Component Simplification — Design

**Date:** 2026-07-06
**Branch:** `feat/ui-redesign-workspace` (continues the workspace+inspector redesign)
**App:** `apps/ui`
**Beads:** fleetsim-all-w5ru

## Goal

Raise the quality of mouse interactions, make navigation between states/modes explicit and
conflict-free, and simplify the React component architecture — without new libraries and
without touching deck.gl rendering internals beyond interaction config. Keep it simple:
every change below either fixes an audited defect or deletes duplication.

## Audit summary (three parallel audits, 2026-07-06)

- **Interactions:** cursor feedback (grab/grabbing/pointer) is unreachable in normal
  browsing because `cursorForDispatchState(BROWSE)` returns `"default"` and `getCursor`
  early-returns on anything ≠ `"grab"`. `pickingRadius` is 0. Vehicle selection re-centers
  the viewport at fixed zoom 15 on every ~1s tick (`useTracking`), fighting the user.
  Geofences are not pickable. `dragRotate` is on for a 2D map. Vehicles have two stacked
  hover treatments (autoHighlight + React ring). Dead config (unused
  `vehicle-selection-ring` z-order key, duplicate `controller`).
- **Modes:** no coordinator — `activePanel`, `dispatchMode`, `drawingActive`, `isRecording`
  are independent booleans. Dispatch and geofence-draw can be active simultaneously: both
  window-level Escape handlers fire at once, both hint banners overlap at the same position,
  and the draw tool's capture-phase mousedown silently eats dispatch clicks. Dispatch mode's
  only exit button lives inside the vehicles panel, so navigating away orphans the mode.
  No global Escape for panel/inspector (map-container-scoped only). Replay swaps the whole
  BottomDock with no explanation.
- **Components:** selection is split across `filters.selected` (vehicles) and
  `selectedItem` (road/POI), hand-reconciled in App. App renders a 9-way `activePanel`
  conditional chain while NavRail independently declares the same panel list. Prop drilling:
  MapView 28 props, Vehicles 14, BottomDock 12. `PanelShell` exists but is unused; a list-row
  shell is hand-rolled in 6 panels. Duplicate `Vehicles.test.tsx` in two locations.

## Design

### 1. One interaction-mode source of truth

New `useInteractionMode` hook owning a discriminated union:

```ts
type InteractionMode =
  | { kind: "browse" }
  | { kind: "dispatch" } // internal DispatchState FSM stays as dispatch's sub-state
  | { kind: "draw-geofence" };
```

- Entering any mode exits the others (mutual exclusion replaces the missing guards).
- Replay stays server-driven (`replayStatus.mode`) and is not folded in, but entering
  dispatch/draw is blocked during replay.
- `dispatchMode` boolean and `drawingActive` boolean become derived from / replaced by this
  union; `useDispatchFlow` and `useGeofenceManager` receive enter/exit callbacks instead of
  owning their own mode flags.

### 2. One keyboard dispatcher, one mode banner

- Single `window`-level keydown listener (in App or the mode hook) routing Escape by
  priority: cancel geofence draw → exit dispatch → clear selection/close inspector → close
  active panel. Deletes the two competing window listeners
  (`useDispatchShortcuts`, `GeofenceDrawTool`) and stops relying on map-container focus.
- One shared `ModeBanner` component (top-center) rendered from the mode union, with the
  mode's hint text and an explicit **Exit** button — replaces `DispatchHint` and the
  draw tool's inline banner, fixes both the overlap and the orphaned-dispatch problem.
- Replay: keep the dock swap, but the ReplayDock states what's happening
  ("Replaying <name> — live controls paused") with the Stop action.

### 3. One selection model

`selection: { kind: "vehicle" | "road" | "poi"; id: string } | null` in a single hook
(`useSelection`), replacing `filters.selected` + `selectedItem` and App's hand-written
cross-clearing. Inspector derives its target itself (selector hook) instead of App scanning
`vehicles.find(...)` every render. Map click-to-clear, list clicks, search selection, and
Escape all go through the same setter.

### 4. Map interaction fixes (config-level, no rendering changes)

- Cursor: browse = `grab`, dragging = `grabbing`, hovering pickable = `pointer`; explicit
  crosshair only for dispatch ROUTE / draw modes. Fix the `getCursor` early-return.
- `pickingRadius={5}` on `<DeckGL>`.
- `controller={{ dragRotate: false, touchRotate: false, scrollZoom: { smooth: true },
inertia: 250 }}`, declared once.
- `useTracking` rework: selecting a vehicle flies to it once at the current zoom
  (min-zoom floor, not fixed 15); any manual pan/zoom breaks follow; no per-tick
  re-centering.
- Geofence polygons become pickable: hover pointer + click selects the fence (same
  `useSelection`? no — fences keep panel-local selection; map click just wires
  `selectedFenceId` through, keeping scope small).
- Drop vehicle IconLayer `autoHighlight` (keep the React hover ring — it matches the
  selection ring language). Delete dead `vehicle-selection-ring` z-order key and the
  duplicate `controller`. Give the selected-road path `pickable:false` (highlight implied
  false interactivity). `title` tooltips on nav rail rows and inspector close.

### 5. Component simplification

- **Panel registry:** single `PANELS: Record<PanelId, { icon, label, group, render }>`
  consumed by both NavRail and App's aside — kills the 9-way conditional and the duplicate
  declaration. Panels keep receiving props via typed render functions (no new context web
  for data).
- **Two narrow contexts only** where drilling is worst: `DispatchContext` (the
  `useDispatchFlow` return, consumed by Vehicles/DispatchFooter/MapView/MapContextMenu) and
  the existing selection hook exposed via `SelectionContext`. Everything else keeps explicit
  props — simple beats clever.
- **`<PanelRow>` primitive** in `PanelPrimitives.tsx` absorbing the hand-rolled row shell in
  the 6 list panels; App's aside adopts the existing `PanelShell`.
- Dispatch toggle button moves from App's JSX into the Vehicles panel header.
- Delete the duplicate `Controls/Vehicles.test.tsx` (keep `__tests__/` copy).

## Out of scope (deliberately)

- Moving client I/O out of BottomDock/RecordReplay/ScenariosPanel (worthwhile but
  independent; separate issue).
- URL/router state, deep-linking, panel-state persistence.
- Recording server-state reconciliation (`isRecording` optimism) — separate bug issue.
- Double-click behavior design; any new deck.gl layers; light theme.

## Testing

- Unit: mode hook (mutual exclusion, Escape priority), selection hook, panel registry
  render, useTracking follow-break behavior. Layer tests assert constructed props
  (pickable, controller config) per the deckgl-map-layers skill.
- Manual: dispatch↔draw exclusivity, Escape chain, cursor states, vehicle-follow feel.
