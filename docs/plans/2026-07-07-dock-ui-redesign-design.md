# Dock UI Redesign — Design

**Date:** 2026-07-07
**Scope:** `apps/ui` control surface only (dock, contextual drawers, dispatch flow). Inspector, SearchBar, and MapContextMenu are explicitly out of scope and untouched.

## Overview

The current control surface (`IconRail` + full-height sliding side panels + `BottomDock` + sticky `DispatchFooter`) reads as a conventional SaaS dashboard: a left icon nav that opens a right-side panel per feature. We're replacing it with a single persistent bottom-center **transport-bar dock**, closer to a DAW/NLE transport bar or a professional ops console. The left rail disappears entirely. Every feature becomes a cluster on the dock; clicking a cluster opens a compact drawer anchored just above that cluster, never a full-height sidebar. The dock itself never resizes — only the drawer above it appears and disappears.

## Dock anatomy (validated)

Five clusters, left to right:

1. **Playback** — play/pause, reset, record. Always one click away, no drawer needed for the common case.
2. **Tempo** — inline event-pacing scrubber (see below). Promoted from a hidden panel to a persistent dock control since it's touched constantly.
3. **Fleet & Dispatch** — merges vehicle list, fleet groups, and the dispatch flow into one drawer.
4. **Sinks & Source** — the Adapter integration (upstream feed + downstream publish targets + realism config).
5. **Monitor** — overflow cluster for everything genuinely secondary: incidents, geofences, analytics, visibility toggles, scenarios, recordings.

Status chips (WS/SIM/adapter health) stay pinned to the dock's right edge regardless of which drawer is open. Only one drawer open at a time; closes on click-elsewhere or Esc.

## Tempo / event-density mechanics

The dock's Tempo control is a direct promotion of `ClockPanel.tsx`'s existing logarithmic slider (`multiplierToSlider`/`sliderToMultiplier`, 1x–3600x) and its `useClock`/`setSpeedMultiplier` hook — **no simulator backend change needed**. `SimulationClock.speedMultiplier` (`apps/simulator/src/modules/SimulationClock.ts`) already scales sim-time advancement per tick, which drives time-of-day transitions (`hour:changed` → morning_rush/midday/evening_rush/night) and therefore the pacing of everything time-of-day-driven (traffic conditions, auto heat-zone regen cadence relative to sim-time). This is exactly the "not really changing speed, just events" framing: the control changes how fast simulated time — and the events keyed to it — unfold, not vehicle km/h.

Vehicle physics (`maxSpeed`, `acceleration`, `deceleration`) and engine cadence (`updateInterval`, `adapterSyncInterval`, currently in `SpeedPanel.tsx`) are a _different_ concern — real-time tuning knobs, not tempo. They move to an "Advanced" tab inside the Monitor drawer, demoted from dock-level real estate.

The dock shows the scrubber inline (compact, no drawer) plus the four existing presets (1×/60×/360×/3600×) and the "real-time / 1 sim-min per second / …" description string, reusing `speedDescription()`.

## Fleet & Dispatch cluster

The current dispatch state machine (`DispatchState.BROWSE → SELECT → ROUTE → DISPATCH → RESULTS` in `useDispatchState.ts`, rendered by `DispatchFooter.tsx`) is good and is **not changing** — same states, same "select vehicles → click map to add stops → Dispatch" flow. What's improving is the surrounding chrome: today, starting a dispatch means opening the Vehicles panel (a full side panel) while a _separate_ sticky footer bar fights for the same bottom-of-screen space as `BottomDock`. In the new design, `Vehicles.tsx` (the vehicle list) and `Fleets.tsx` (fleet grouping) become two tabs inside one Fleet & Dispatch drawer anchored above the dock's Fleet & Dispatch cluster. When dispatch state moves past `BROWSE`, the drawer's own footer becomes the dispatch status/action bar (selected count, stop count, Dispatch/Clear/Retry/Done) — replacing the separate `DispatchFooter` overlay with one that lives inside the drawer shell instead of floating independently above the dock. Map click-to-add-stops behavior is untouched.

## Sinks & Source cluster

Today's `AdapterDrawer.tsx` is a full-width right-side `Sheet` with three tabs — Source (pick/configure the upstream vehicle feed via `SourceTab.tsx`), Sinks (add/remove/edit downstream publish targets via `SinksTab.tsx`), Realism (`RealismTab.tsx`). This maps directly into the new cluster: same three tabs, same `useAdapterConfig` hook and `adapterClient`, just re-hosted in the anchored dock-drawer shell instead of a `Sheet` sliding from the screen edge. The health-derived status badge (Healthy/Needs attention/Unconfigured/Unreachable) moves to sit on the dock cluster itself so adapter health is visible without opening the drawer.

## Monitor cluster

One "more" icon opens a tabbed drawer bundling the remaining panels, each kept as-is internally and just re-hosted as a tab instead of a standalone sliding panel: Incidents (`Incidents.tsx`, badge count carried over from the current `IconRail` incident badge), Geofences (`GeofencePanel.tsx`), Analytics (`AnalyticsPanel.tsx`), Visibility toggles (`TogglesPanel.tsx`), Scenarios (`ScenariosPanel.tsx`), Recordings (`RecordReplay.tsx`), plus the new Advanced tab for vehicle-physics tuning (formerly `SpeedPanel.tsx`). Tabs are a horizontal strip at the top of the drawer; content below reuses the existing `PanelHeader`/`PanelBody` primitives from `PanelPrimitives.tsx` unchanged.

## Visual style

Dark-only professional palette stays as-is (`src/index.css` oklch `@theme` block — no palette changes). What changes:

- The dock itself uses the existing `surface-glass` + `backdrop-blur-md` + `shadow-elevated` treatment already on `BottomDock`'s `DOCK_CLASS` — extend it to the wider 5-cluster bar.
- Drawers anchored above the dock use `shadow-floating` (the "above the map" shadow token, currently used for dialogs/menus) + `surface-glass` for a distinct glass-panel-floating-over-map read, rather than the opaque `surface-raised` used by today's full-height side panels.
- The old left `IconRail` (`surface-raised`, opaque sidebar chrome) is removed entirely — nothing replaces it; the map canvas gains that width back.
- Entrance motion reuses `animate-fade-up`/`animate-scale-in` and the `[data-ready]` reveal pattern already established; drawers get `scale-in` (menu/popover treatment) instead of the panel's slide-in, since they're now popover-like, not sidebar-like.

## Component/file plan

**New files (`apps/ui/src/Dock/`):**

- `Dock.tsx` — root persistent transport-bar container; renders the 5 clusters + right-edge status chips. Replaces `BottomDock.tsx`.
- `DockCluster.tsx` — shared clickable dock segment (icon/label, active state, badge slot).
- `DockDrawer.tsx` — shared anchored-drawer shell (position above its cluster, glass/blur/shadow-floating, close-on-outside-click/Esc, scale-in animation).
- `PlaybackCluster.tsx` — play/pause/reset/record controls, ported from `BottomDock.tsx`.
- `TempoCluster.tsx` — inline log-scale scrubber + presets, ported from `ClockPanel.tsx`.
- `FleetDispatchDrawer.tsx` — tabbed drawer (Vehicles / Fleets) with dispatch-state-aware footer, replacing `DispatchFooter.tsx`'s standalone mount.
- `SinksSourceDrawer.tsx` — re-hosts `Adapter/SourceTab.tsx`, `Adapter/SinksTab.tsx`, `Adapter/RealismTab.tsx` in the drawer shell; status badge surfaced on the cluster.
- `MonitorDrawer.tsx` — tabbed drawer: Incidents / Geofences / Analytics / Toggles / Scenarios / Recordings / Advanced.
- `AdvancedTuningTab.tsx` — vehicle-physics sliders ported from `SpeedPanel.tsx`.
- `StatusChips.tsx` — WS/SIM/adapter-health chips, pinned to the dock's right edge.

**Modified:**

- `App.tsx` — remove `IconRail`, remove per-panel conditional mounts (`activePanel === "..."`), remove standalone `DispatchFooter` mount, remove `usePanelNavigation`; mount `<Dock/>` in its place.
- `hooks/usePanelNavigation.ts` — replaced by a new `hooks/useDockNavigation.ts` (which cluster/drawer is open; single-open-at-a-time semantics).

**Removed (content ported, files deleted once migration is verified):**

- `Controls/IconRail.tsx`, `Controls/BottomDock.tsx`, `Controls/DispatchFooter.tsx`, `Controls/SpeedPanel.tsx`, `Controls/ClockPanel.tsx`.

**Unchanged, re-hosted as drawer tabs (content untouched, only their mounting point moves):**

- `Controls/Vehicles.tsx`, `Controls/Fleets.tsx`, `Controls/Incidents.tsx`, `Controls/GeofencePanel.tsx`, `Controls/AnalyticsPanel.tsx`, `Controls/TogglesPanel.tsx`, `Controls/ScenariosPanel.tsx`, `Controls/RecordReplay.tsx`, `Controls/Adapter/*`, `Controls/PanelPrimitives.tsx` (kept, reused inside drawers).

**Untouched:** `Inspector/*`, `SearchBar`, `ContextMenu`/`MapContextMenu`, all of `Map/*`, `useDispatchState.ts`, `useDispatchFlow`, `useClock`, `useAdapterConfig`, simulator (`apps/simulator`) — no backend changes.

## Non-goals

- Do not change the dispatch state machine or algorithm (`useDispatchState.ts`, `useDispatchFlow`) — only its surrounding chrome.
- Do not change simulator core logic. `SimulationClock.speedMultiplier` already fully covers the tempo requirement; no new backend config/interval is needed.
- Do not change the color palette, Inspector, SearchBar, or map layers.
- Do not implement code as part of this document — design only.

## Revision — 2026-07-08 (single morphing panel + tight-technical density)

After the first implementation, the per-cluster anchored-drawer model was reworked
(user feedback: navigation felt scattered, styling too generic). Two changes,
validated against an interactive mockup before coding:

- **One morphing panel.** Every cluster now opens the _same_ fixed-width panel
  (`Dock/DockPanel.tsx`) centered above the dock, tied to it by a down-notch; only
  the contents change, so the surface never jumps position or width. Replaces the
  five independently-anchored `DockDrawer`s. `useClock` and `useAdapterConfig` are
  lifted into `Dock.tsx` (the inline tempo scrubber + Tempo panel must share clock
  state; the Sinks health dot must keep polling while its panel is closed).
- **Tight-technical density.** A shared `Dock/DockPanelKit.tsx` (PanelHead, Eyebrow,
  Hairline, SegTabs, HealthChip, StatusDot, PanelScroll, `mono`) encodes the density
  in one place; every panel composes it. Monospace tabular numerics, hairline rows
  (no cards), 9px uppercase eyebrows. Leaf panels suppress their own titles via a new
  `SuppressPanelHeader` context in `PanelPrimitives.tsx`. The virtualized vehicle list
  keeps `react-window` (row height 62→32).

New files: `DockPanel.tsx`, `DockPanelKit.tsx`, `TempoInline.tsx`, `TempoPanel.tsx`,
`FleetPanel.tsx`, `SinksPanel.tsx`, `MonitorPanel.tsx`, `tempoScale.ts`. The v1
`*Drawer.tsx`/`TempoCluster.tsx` files were removed.
