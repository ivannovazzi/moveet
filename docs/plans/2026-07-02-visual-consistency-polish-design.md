# Visual Consistency Polish — Design

**Date:** 2026-07-02
**Branch:** `feat/ui-redesign-workspace` (continues the workspace+inspector redesign, not yet merged)
**App:** `apps/ui`

## Goal

Bring the components untouched by the workspace redesign up to the visual bar set by
`NavRail`/`Inspector`/`Vehicles`/`BottomDock`/`TogglesPanel`. Scope is strictly **visual
detail and consistency** — spacing, borders, shadows, hover/focus states, design-token
adoption. No behavior changes, no new components. Motion, accessibility, and state-coverage
passes are deferred.

### Decisions (from brainstorming)

- **Scope:** full-app pass, but a read-only audit found all drift concentrated in the
  pre-redesign panels; this session's components and Zoom/SearchBar/legends checked clean.
- **Row treatment:** "flatten where simple" — Incidents, RecordReplay (recordings list),
  ScenariosPanel, and GeofencePanel (fences + alerts) adopt the flat hairline-row recipe
  from `Vehicles.tsx`. **Fleets keeps its card boundary** (rows expand to reveal nested
  member lists — the boundary carries meaning), but its internal member/candidate rows and
  dividers get consistent treatment.

## Section 1 — Domain color tokens

Raw hex color maps become oklch tokens in `src/styles/tokens.css`, following the
`--color-vehicle-*` pattern (oklch siblings of the theme families, visually close to the
hex values they replace):

- `--color-incident-closure` (≈ #f44336, red — align with the `--color-overlay-danger` hue),
  `--color-incident-accident` (≈ #ff9800, orange), `--color-incident-construction`
  (≈ #ffeb3b, yellow) — consumed by `Incidents.tsx`'s `INCIDENT_COLORS`.
- `--color-geofence-restricted` (≈ #ef4444, red), `--color-geofence-delivery` (≈ #22c55e,
  green), `--color-geofence-monitoring` (≈ #3b82f6, blue — accent hue family) — consumed by
  `GeofencePanel.tsx`'s `typeBadgeColor()`.
- `Map/POI/POI.tsx`'s arbitrary hex values (`border-[#333d]`, `border-[#ffffff66]`,
  `fill-[#333d]`, `fill-[#fffd]`) move to existing semantic tokens where they match, or get
  POI-family tokens if not.

## Section 2 — Row flattening (the Vehicles recipe)

The flat-row recipe from `Vehicles.tsx`: `border-b border-border-soft px-2.5 py-2`, hover
`hover:bg-white/[0.04]`, selected/active `bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]`,
`focus-visible` ring. Applied to:

- `Incidents.tsx` incident rows
- `RecordReplay.tsx` recording rows (the generate-form box keeps a card — it is a form
  section, not a list row)
- `ScenariosPanel.tsx` scenario rows
- `GeofencePanel.tsx` fence rows and alert rows
- `Fleets.tsx`: card boundary stays on fleet rows; member/candidate rows get the flat
  treatment; `border-border/60` dividers → `border-border-soft`

## Section 3 — Shared-primitive adoption

- The 3 identical hand-rolled placeholders in `Controls/Adapter/` (`AdapterDrawer.tsx`,
  `SourceTab.tsx`, `SinksTab.tsx`) become `PanelEmptyState` (kills the competing
  dashed-border empty-state dialect).
- `AdapterDrawer.tsx`'s local `statusToneClass` span becomes `PanelBadge` with the matching
  `healthy`/`warning`/`neutral` tone.
- `GeofencePanel.tsx`'s hand-rolled Confirm/Cancel drawing buttons become the shared
  `Button` component (`default`/`outline` variants, as in `DispatchFooter.tsx`).

## Section 4 — One-off fixes

- `Map/POI/POI.tsx` label popup: `bg-card/90` + `animate-in fade-in` + `duration-200
ease-out` → `surface-glass` + `shadow-floating` + `animate-scale-in` (the project's own
  motion vocabulary; this is the only place in the app not speaking it).
- `Fleets.tsx` circular icon buttons: `size-[22px]` → `size-6`.
- `RecordReplay.tsx:428` `border-border/60` → `border-border-soft`.

## Out of scope

- Behavior, props, data flow — everything is markup/class-level.
- shadcn primitives in `components/ui/`.
- Motion/animation redesign beyond the POI vocabulary fix.
- Accessibility and empty/error-state coverage passes (future work).
