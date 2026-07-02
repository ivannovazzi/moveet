# Visual Consistency Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (parallel
> dispatch variant — agents implement + self-review + report; controller commits).

**Goal:** Execute `2026-07-02-visual-consistency-polish-design.md`: token-ify domain colors,
flatten simple list rows to the Vehicles recipe, adopt shared primitives in the Adapter
panels, fix the POI popup's divergent surface/motion.

**Architecture:** Pure markup/class-level changes in `apps/ui`. No behavior, prop, or data
changes. Baseline vocabulary: `src/index.css` (@theme tokens, shadows, motion),
`src/styles/tokens.css` (domain colors), `src/Controls/PanelPrimitives.tsx` (panel
primitives), `src/Controls/Vehicles.tsx` (the flat-row recipe, lines ~197-210).

**Verification bar (every task):** targeted `npm run test -- <files>` green; controller runs
full `type-check && lint && test && build` once per round before committing. Lint-warning
count must not exceed the 53-warning baseline. Existing tests that assert on removed classes
must be updated to assert the new classes instead (do not delete assertions).

---

## Execution grouping

- **Task 0 (controller, inline):** tokens.css additions — tiny, done directly to avoid an
  agent round-trip and to guarantee the consuming tasks all see identical token names.
- **Round 1 (4 agents in parallel, disjoint files):** Tasks A, B, C, D.
- **Final:** controller runs full verification, commits per task, browser-checks.

---

## Task 0: Domain color tokens (controller)

**File:** `apps/ui/src/styles/tokens.css`

Append two blocks after the `--color-vehicle-*` block, following its comment style:

```css
/* Incident type colors — consumed by Controls/Incidents.tsx badges/markers.
     oklch siblings of the overlay-severity family, visually close to the raw
     hex values they replace (#f44336 / #ff9800 / #ffeb3b). */
--color-incident-closure: oklch(0.63 0.2 25);
--color-incident-accident: oklch(0.75 0.16 60);
--color-incident-construction: oklch(0.88 0.16 100);

/* Geofence type colors — consumed by Controls/GeofencePanel.tsx type badges.
     Replaces raw Tailwind-palette hex (#ef4444 / #22c55e / #3b82f6). */
--color-geofence-restricted: oklch(0.63 0.2 25);
--color-geofence-delivery: oklch(0.72 0.17 150);
--color-geofence-monitoring: oklch(0.62 0.15 250);
```

Verify: `npm run test -- --run` unaffected (CSS-only). Commit:
`feat(ui): add incident and geofence domain color tokens`.

## Task A: Incidents + Scenarios rows

**Files:** `apps/ui/src/Controls/Incidents.tsx`, `apps/ui/src/Controls/ScenariosPanel.tsx`,
plus their existing test files if any assert on row classes.

1. `Incidents.tsx:20-24`: `INCIDENT_COLORS` values → `"var(--color-incident-closure)"` etc.
2. `Incidents.tsx:111` (and any sibling rows): replace the bordered-card row classes
   (`rounded-md border border-border-soft bg-white/[0.03] … hover:bg-white/[0.06]`) with the
   Vehicles flat recipe: `border-b border-border-soft px-2.5 py-2` +
   `hover:bg-white/[0.04]` + existing focus-visible ring classes from Vehicles. Remove the
   per-row rounded corners; the list container keeps its padding.
3. `ScenariosPanel.tsx:310`: same flat-row conversion for scenario rows. If a row has an
   active/selected state, use `bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]`.
4. Read each file fully first; if a "row" is actually an expandable/nested card (like
   Fleets), leave the card and note it in the report instead of flattening blindly.

## Task B: GeofencePanel

**File:** `apps/ui/src/Controls/GeofencePanel.tsx` (+ its test file if class assertions).

1. `typeBadgeColor()` (lines 22-31): return `"var(--color-geofence-restricted)"` etc.
2. Fence rows (~line 166) and alert rows (~line 218): flat-row conversion per the recipe.
3. Confirm/Cancel drawing buttons (~lines 129, 136): replace hand-rolled `<button>`s with
   the shared `Button` from `@/components/Inputs` — `default` variant for Confirm, `outline`
   for Cancel (mirror `DispatchFooter.tsx`'s usage). Preserve exact onClick/disabled logic
   and visible labels.

## Task C: Fleets + RecordReplay

**Files:** `apps/ui/src/Controls/Fleets.tsx`, `apps/ui/src/Controls/RecordReplay.tsx`
(+ test files if class assertions).

1. `Fleets.tsx`: **keep** the outer fleet-row card (expandable, boundary is meaningful).
   Member/candidate rows (~163, ~205) get the flat treatment (`border-b border-border-soft`
   hairlines inside the card, flat hover). `border-border/60` (~156) → `border-border-soft`.
   `size-[22px]` icon buttons (~172, ~214) → `size-6`.
2. `RecordReplay.tsx`: recording rows (~318) get the flat-row conversion. The generate-form
   box (~203) **keeps** its card (it is a form section, not a list row) — but normalize its
   classes to `border border-border-soft surface-raised shadow-raised` if it deviates.
   `border-border/60` (~428) → `border-border-soft`.

## Task D: Adapter primitives + POI popup

**Files:** `apps/ui/src/Controls/Adapter/AdapterDrawer.tsx`,
`apps/ui/src/Controls/Adapter/SourceTab.tsx`, `apps/ui/src/Controls/Adapter/SinksTab.tsx`,
`apps/ui/src/Map/POI/POI.tsx` (+ test files).

1. Replace the 3 identical hand-rolled placeholders (`rounded-md border border-dashed
border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground` at
   AdapterDrawer:119, SourceTab:93, SinksTab:129) with `PanelEmptyState` from
   `../PanelPrimitives` (relative path from Adapter/ is `../PanelPrimitives`). Keep the
   message text verbatim.
2. `AdapterDrawer.tsx:31-35`: delete the local `statusToneClass` map; render `PanelBadge`
   with `tone="healthy" | "warning" | "neutral"` mapped from the existing status logic.
3. `POI.tsx:43,49,51-58`: label popup → `surface-glass` + `shadow-floating` + existing
   border token instead of `bg-card/90`; `animate-in fade-in duration-200 ease-out` →
   `animate-scale-in`; arbitrary hex (`border-[#333d]`, `border-[#ffffff66]`,
   `fill-[#333d]`, `fill-[#fffd]`) → nearest semantic tokens (`border-border`,
   `fill-popover`-style tokens) — read the SVG marker markup carefully; if a hex encodes a
   deliberate translucent dark outline with no token equivalent, add a `--color-poi-*`
   token to tokens.css rather than keeping raw hex. **Note:** Task 0 owns tokens.css —
   if you need a new POI token, report it for the controller to add rather than editing
   tokens.css yourself (parallel-agent file boundary).

## Final integration (controller)

1. `npm run type-check && npm run lint && npm run test && npm run build` — all green,
   warnings ≤ 53.
2. Browser pass (dev server from the worktree): open each touched panel — Incidents,
   Geofences (incl. drawing-mode Confirm/Cancel), Fleets (expand a fleet), Recordings,
   Scenarios, Adapter (all tabs), and hover a POI on the map.
3. Commit per task; update the design doc if any decision changed during implementation.
