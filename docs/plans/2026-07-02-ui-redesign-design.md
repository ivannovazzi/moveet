# UI Redesign — Workspace + Inspector — Design

**Date:** 2026-07-02
**Branch:** `feat/ui-redesign-workspace` (to be created)
**App:** `apps/ui`

## Goal

Redesign the Moveet dashboard's information architecture, component patterns, and states
from first principles, while preserving 100% of existing functionality and the deck.gl map
rendering. This follows PR #196 (map UX foundation, vehicle/route polish, professional chrome
pass), which is now merged to `main` — this redesign builds on that token/motion foundation
rather than replacing it.

### Decisions (from brainstorming)

- **Audience:** OSS project, generic vehicle-fleet simulator, no single-org branding.
- **IA scope:** Open to structural rethink (not a reskin within the current shape).
- **Theme:** Dark-only, no light mode / toggle.
- **Direction chosen:** "Workspace + contextual inspector" (labeled left nav + map +
  on-demand right inspector + real transport bar), over a "grouped sidebar" (lower-risk,
  same shape) or "command-palette-first" (boldest, weaker discoverability for OSS visitors)
  alternative.
- **Design system foundation:** Keep and extend the existing oklch token system in
  `src/index.css` (palette, elevation shadow scale, easing/motion scale) — it already meets
  the brief's "calm, precise, restrained" bar. Effort goes into structure/components/states,
  not re-deriving color science.

## Current state (baseline, screenshot-verified against running dev build)

- Icon-only left rail, 12 flat unlabeled nav items (Vehicles, Fleets, Incidents, Geofences,
  Recordings, Scenarios, Visibility, Speed, Simulation Clock, Analytics, Adapter, Settings).
- Selecting a nav item opens a single sliding panel that overlays the map (no persistent
  browse + inspect split).
- Floating, uncoordinated chrome: top-center search bar, bottom-left vehicle-type legend
  card, bottom-center transport dock (Start/Reset/Make Zones/Record/Speed toggle/WS·SIM
  status), bottom-right zoom controls — four independent floating layers.
- List rows (e.g. vehicle list) are bordered cards per row; type badges are bordered pills.
- Numeric fields (speed, distance) are not tabular — digits reflow on update.

## Section 1 — Layout & Navigation

Three-zone workspace replacing icon-rail + panel-over-map:

- **Left rail** (fixed ~240px, collapsible to icon-only) — labeled nav grouped into
  **Fleet** (Vehicles, Fleets), **Operations** (Incidents, Geofences, Recordings, Scenarios),
  **Monitor** (Analytics, Visibility, Adapter), each group under an 11px uppercase
  micro-label header. Settings pins to the bottom outside the scroll area. Speed and
  Simulation Clock move out of nav into the transport bar (they're playback controls, not
  destinations). Search moves from the floating top bar into the rail's top slot.
- **Center — the map.** Unchanged as centerpiece; loses the floating legend and one of the
  two search affordances, reducing competing overlays from four to two (transport bar, zoom
  controls).
- **Right inspector** (on-demand, ~320px, overlays on narrow viewports) — opens when a
  vehicle/incident/geofence is selected from the map or a list. Decouples "browsing a list"
  from "inspecting one entity" so both can be open at once — the main structural win over
  today's single-panel model.
- **Bottom transport bar** — Start/Reset/Make Zones/Record/Speed/Clock/WS·SIM status as one
  coherent grouped control strip, not a pill of ambiguous icon buttons.
- Vehicle-type legend folds into the Visibility panel (toggle + swatch per type) instead of
  permanent floating map chrome.

## Section 2 — Design System Foundation

- **Color & elevation:** keep `src/index.css` oklch tokens as-is (background/card/popover,
  single accent-as-primary-as-ring, status-ok/warn/error/idle, `shadow-raised/elevated/
floating/glow-accent`). Extend, don't replace, for the new inspector panel and nav group
  dividers.
- **Typography as primary hierarchy tool:**
  - Keep Inter for UI text.
  - Add `font-variant-numeric: tabular-nums` to all live data (speed, distance, ETA, counts)
    — fixes real digit-reflow jitter during simulation ticks, not just a polish nit.
  - Formalize an explicit ~6-step type scale: micro-label (11px uppercase tracked),
    body (13px), emphasis (14px medium), panel-title (15px semibold), metric
    (20px semibold, stat cards), display (24px, headline counts). Replaces today's
    per-component ad hoc sizing.
- **Spacing:** formalize a 4px base unit; audit found current panels mixing 12/16/20px gaps
  inconsistently.
- **Radius:** keep `--radius: 0.375rem` (already matches "no oversized radii").
- **Iconography:** keep lucide-react; every rail icon gains a persistent text label.

## Section 3 — Component Patterns

- **Nav rail item:** icon + label inline, 40px row height, active state = filled background
  - 2px left accent bar (replaces full-tile highlight). Group headers use the micro-label
    type.
- **List rows** (vehicles/incidents/fleets): flatten from bordered cards to hairline
  (`border-soft`) separated rows; type badge becomes a color dot + label instead of a
  bordered pill, so the changing data (speed, route progress) reads over the chrome. Route
  progress bars keep their current treatment.
- **Inspector panel (new):** header (icon, name, close), 2-column metadata grid, route/
  timeline visualization, sticky footer for contextual actions (dispatch, geofence assign).
  The one net-new component; everything else is a refinement of existing patterns.
- **Transport bar:** three dividered clusters — playback (Start/Reset), simulation tools
  (Make Zones/Record), status (WS/SIM + Speed + Clock). Icon-only buttons gain tooltips.
- **Search:** single combobox in the rail's top slot, results grouped by type (Vehicles /
  Roads / Places) under micro-label headers.
- **Buttons/inputs/badges:** reuse existing shadcn primitives in `components/ui/`; no new
  component library.

## Section 4 — States & Motion

- **Empty states:** consistent pattern per panel — large dimmed nav icon, one primary line,
  one secondary line, single action button where applicable (e.g. "Make zones" when
  geofences are empty). No illustrations.
- **Loading states:** confirm the existing `animate-sheen` skeleton shimmer is applied to
  panel content during initial WS connect/data-fetch (vehicle list, analytics stat cards,
  inspector), not only the one-time `[data-ready]` reveal. Skeletons match final layout to
  avoid layout shift.
- **Error/disconnected state:** escalate beyond the WS status dot — a persistent, non-blocking
  "Reconnecting to simulator…" banner on disconnect, since losing real-time vehicle data is
  the app's most important failure mode.
- **Motion:** reuse the existing `fast/normal/slow` + `emphasized/standard/exit` scale as-is.
  New applications: inspector slides in with `emphasized` easing; list-row insert/remove uses
  `fade-up` with light stagger; reconnect banner uses `scale-in`. No new animation primitives.

## Section 5 — Map Visual Layer

- No rebuild of deck.gl rendering; only chrome-adjacent changes:
  - Legend removed from floating map chrome, absorbed into the Visibility panel.
  - Zoom controls stay bottom-right floating (universal map convention).
  - Selection acknowledgment: dim non-selected vehicles (~60% opacity) when the inspector
    has a vehicle open, via an accessor change in `VehiclesLayer` (RAF hot-path pattern per
    `deckgl-map-layers` skill — not a new layer).
  - Route/direction rendering, road network, traffic overlay, heatmap, POI layers: unchanged,
    out of scope.

## Out of scope

- Light theme.
- deck.gl rendering internals beyond the one selection-dimming accessor change.
- Backend/simulator/adapter changes — UI only.
- Mobile-first responsive rework (narrow-viewport overlay behavior for the inspector is the
  only responsive concern called out above).
