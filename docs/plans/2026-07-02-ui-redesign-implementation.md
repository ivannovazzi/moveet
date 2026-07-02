# UI Redesign — Workspace + Inspector — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development,
> if executed in this session with parallel dispatch) to implement this plan task-by-task.

**Goal:** Implement the workspace+inspector redesign from
`docs/plans/2026-07-02-ui-redesign-design.md`: labeled grouped nav, transport bar absorbing
Speed/Clock, vehicle-type legend folded into Visibility, flattened vehicle list rows, a new
on-demand right Inspector panel, and dimmed non-selected vehicles on the map — without
regressing any existing behavior.

**Architecture:** `apps/ui` React 19 + Tailwind v4 + deck.gl. All work is UI-layer only (no
backend/simulator changes). Follow existing patterns exactly: shadcn primitives in
`components/ui/`, `PanelShell/PanelHeader/PanelBody/PanelEmptyState/...` from
`Controls/PanelPrimitives.tsx`, the `useRegisterLayers` pattern for the one deck.gl change
(see `deckgl-map-layers` skill).

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + @testing-library/react (jsdom),
deck.gl 9 (IconLayer/ScatterplotLayer), lucide-react (via `@/components/Icons`).

**Scope note (found during investigation, not assumed):** Section 4 of the design doc
("States & Motion" — empty/loading/error states) is **already fully implemented**.
`PanelEmptyState`/`PanelErrorState`/`PanelLoadingState` are already used consistently across
Vehicles, Fleets, Incidents, RecordReplay, ScenariosPanel, GeofencePanel, AnalyticsPanel, and
`ConnectionStatus.tsx` already implements a proper reconnecting/disconnected banner with retry.
**No work needed there** — this plan only covers genuine gaps: layout/nav, transport bar,
list-row density, the new Inspector, and one map accessor change.

**Inspector scope note:** `filters.selected` (vehicle) and `selectedItem` (`Road | POI | null`,
via `isPOI`/`isRoad` guards in `src/utils/typeGuards.ts`) are the only entity-selection state
that exists today. Incidents and geofences have no equivalent "currently selected" state.
Building that plumbing is out of scope for this plan (would require new state in
`useIncidents`/`useGeofenceManager` not requested by the design brief's core IA fix) — the
Inspector ships for **vehicles and POIs** only. Note this explicitly to the user; do not
silently drop it.

---

## Execution grouping (for multi-agent dispatch)

- **Round 1 (solo, do first — fast, unblocks nothing but touches no shared files):** Task 1.
- **Round 2 (3 agents in parallel — disjoint files, safe to run concurrently):** Task 2, Task 3, Task 5.
- **Round 3 (solo, after Task 2 lands — depends on Task 2's `App.tsx`/`PanelId` changes):** Task 4.

Have each Round 2 agent report its diff instead of committing directly (avoids concurrent
`git commit` races in the shared worktree); the orchestrator reviews and commits each task's
diff separately once the agent reports done.

---

## Task 1: Design tokens — type scale, spacing, tabular-nums

**Files:**

- Modify: `apps/ui/src/index.css`

**Step 1: Add the type scale as a documented comment + Tailwind-consumable custom properties**

Add to the `@theme` block (after the existing `--font-sans` line, ~line 48):

```css
/* ── Polish layer: type scale ──────────────────────────────────────────
     Explicit steps so components stop choosing sizes ad hoc. Use the
     matching Tailwind text-* utility directly (these are documentation +
     the two non-default sizes below register their own utilities).
       • micro-label → text-[11px] uppercase tracking-wider (group headers,
         eyebrows) — already used ad hoc as text-[10px]/text-xs; standardize
         on 11px going forward for NEW group-header usages (nav groups).
       • body        → text-[13px] (existing default for list rows)
       • emphasis     → text-sm font-medium (14px)
       • panel-title  → text-[15px] font-semibold
       • metric       → text-xl font-semibold (20px, stat cards)
       • display      → text-2xl font-semibold (24px, headline counts)     */
--text-micro: 11px;
--text-panel-title: 0.9375rem;
```

This registers `text-micro` and `text-panel-title` as new Tailwind utilities (Tailwind v4
reads the `--text-*` namespace) alongside the built-in `text-sm/base/xl/2xl` used for the
other scale steps — no need to invent custom properties for sizes Tailwind already ships.

**Step 2: Add a `tabular-nums` utility note and apply it where missing**

`tabular-nums` is already a built-in Tailwind utility (already used in `BottomDock.tsx`,
`ConnectionStatus.tsx`, `ClockPanel.tsx`, `Vehicles.tsx`'s speed field, `PanelBadge`). The one
gap found: `apps/ui/src/Controls/Vehicles.tsx:266-268`, the route-distance text
(`formatRouteDistance` output) is not tabular. Fix as part of Task 3 (same file), not here —
listing it here so it isn't missed.

**Step 3: Verify spacing** — read `apps/ui/src/Controls/PanelPrimitives.tsx` and 2-3 panels;
confirm gaps use Tailwind's default 4px-based scale (`gap-1`, `gap-1.5`, `gap-2`, `gap-3`, `p-3`)
consistently — they already do (verified: `PanelHeader` `px-3 py-3`, `PanelBody` `p-3`,
`gap-1.5`/`gap-1`/`gap-2` throughout). **No spacing token changes needed** — the informal 4px
scale is already consistent; the design doc's "audit found mixing" concern was about the type
scale, not spacing. Do not invent a formal `--spacing-*` token layer for no behavioral gain.

**Step 4: Run typecheck + full test suite**

```bash
cd apps/ui && npm run type-check && npm run test
```

Expected: no errors, 794 tests passing (baseline).

**Step 5: Commit**

```bash
git add apps/ui/src/index.css
git commit -m "feat(ui): add micro-label and panel-title type scale tokens"
```

---

## Task 2: Nav rail restructure + transport bar merge + legend fold-in

**Files:**

- Rename: `apps/ui/src/Controls/IconRail.tsx` → `apps/ui/src/Controls/NavRail.tsx`
- Modify: `apps/ui/src/hooks/usePanelNavigation.ts` (import path only)
- Modify: `apps/ui/src/App.tsx`
- Modify: `apps/ui/src/Controls/BottomDock.tsx`
- Modify: `apps/ui/src/Controls/TogglesPanel.tsx`
- Delete: `apps/ui/src/Controls/SpeedPanel.tsx`, `apps/ui/src/Controls/ClockPanel.tsx`
- Delete: `apps/ui/src/Map/TypeLegend.tsx`
- Test: `apps/ui/src/Controls/__tests__/NavRail.test.tsx` (new)
- Test: `apps/ui/src/Controls/__tests__/TogglesPanel.test.tsx` (extend existing)
- Test: `apps/ui/src/Controls/__tests__/BottomDock.test.tsx` (new)

### Step 1: Write failing tests for the new `NavRail`

Create `apps/ui/src/Controls/__tests__/NavRail.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NavRail from "../NavRail";

describe("NavRail", () => {
  it("renders labeled nav items grouped under Fleet, Operations, and Monitor headers", () => {
    render(<NavRail activePanel={null} onPanelChange={vi.fn()} />);
    expect(screen.getByText("Fleet")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Monitor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vehicles" })).toBeInTheDocument();
    // Speed and Clock are no longer nav destinations.
    expect(screen.queryByRole("button", { name: "Speed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simulation Clock" })).not.toBeInTheDocument();
  });

  it("calls onPanelChange with the clicked panel id, toggling off if already active", async () => {
    const onPanelChange = vi.fn();
    render(<NavRail activePanel={null} onPanelChange={onPanelChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Vehicles" }));
    expect(onPanelChange).toHaveBeenCalledWith("vehicles");
  });

  it("shows the incident count badge on the Incidents item", () => {
    render(<NavRail activePanel={null} onPanelChange={vi.fn()} incidentCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
```

**Step 2: Run it — confirm it fails** (module doesn't exist yet):

```bash
npm run test -- NavRail
```

Expected: FAIL — `Cannot find module '../NavRail'`.

### Step 3: Create `NavRail.tsx`

`git mv apps/ui/src/Controls/IconRail.tsx apps/ui/src/Controls/NavRail.tsx`, then rewrite:

```tsx
import { SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import {
  CarIcon,
  LayersIcon,
  AlertIcon,
  RecordCircleIcon,
  EyeIcon,
  Gear,
  ChartIcon,
  GeofenceIcon,
  ScenarioIcon,
} from "@/components/Icons";

export type PanelId =
  | "vehicles"
  | "fleets"
  | "incidents"
  | "recordings"
  | "scenarios"
  | "toggles"
  | "analytics"
  | "adapter"
  | "geofences";

interface NavRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

interface NavItem {
  id: PanelId;
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Fleet",
    items: [
      { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
      { id: "fleets", Icon: LayersIcon, label: "Fleets" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "incidents", Icon: AlertIcon, label: "Incidents" },
      { id: "geofences", Icon: GeofenceIcon, label: "Geofences" },
      { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
      { id: "scenarios", Icon: ScenarioIcon, label: "Scenarios" },
    ],
  },
  {
    label: "Monitor",
    items: [
      { id: "toggles", Icon: EyeIcon, label: "Visibility" },
      { id: "analytics", Icon: ChartIcon, label: "Analytics" },
    ],
  },
];

const bottomItem: NavItem = { id: "adapter", Icon: Gear, label: "Adapter" };

export default function NavRail({ activePanel, onPanelChange, incidentCount }: NavRailProps) {
  const renderButton = ({ id, Icon, label }: NavItem) => (
    <SquaredButton
      key={id}
      className="relative w-full justify-start gap-2.5 px-3 aria-pressed:before:absolute aria-pressed:before:left-0 aria-pressed:before:top-1.5 aria-pressed:before:bottom-1.5 aria-pressed:before:w-0.5 aria-pressed:before:rounded-full aria-pressed:before:bg-accent aria-pressed:before:content-['']"
      icon={<Icon />}
      iconClassName="size-4"
      size="lg"
      variant="ghost"
      tone="active"
      active={activePanel === id}
      onClick={() => onPanelChange(activePanel === id ? null : id)}
      aria-pressed={activePanel === id}
    >
      <span className="flex-1 text-left text-sm">{label}</span>
      {id === "incidents" && incidentCount != null && incidentCount > 0 && (
        <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-[3px] text-[9px] font-semibold leading-none text-white">
          {incidentCount > 9 ? "9+" : incidentCount}
        </span>
      )}
    </SquaredButton>
  );

  return (
    <nav
      className={cn(
        "z-[31] flex w-60 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-border-soft surface-raised px-2 py-3",
        "shadow-[4px_0_16px_-8px_rgba(0,0,0,0.5)]",
        "pointer-events-none -translate-x-4 opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
        "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-x-0 [[data-ready]_&]:opacity-100"
      )}
      aria-label="Sidebar navigation"
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pb-2">
          <span className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </span>
          {group.items.map(renderButton)}
        </div>
      ))}
      <div className="flex-1" />
      {renderButton(bottomItem)}
    </nav>
  );
}
```

Note: `SquaredButton` currently renders icon-only, fixed-square buttons (per its use in
`IconRail.tsx`); check `apps/ui/src/components/Inputs.tsx` for its prop contract — if it
doesn't support `children` alongside `icon`, either extend `SquaredButton` to render optional
trailing/inline content, or use the base `Button` component (`@/components/Inputs`) with
`icon`+label composed manually instead. Prefer extending `SquaredButton` minimally (add a
`children` slot rendered after the icon when the button isn't icon-only) since `ReplayDock`'s
speed buttons and other rail-adjacent buttons will likely want the same shape later. Match
whatever `SquaredButton`'s actual API is — read the file before writing this component.

### Step 4: Update the one import site

`apps/ui/src/hooks/usePanelNavigation.ts:2` — change
`import type { PanelId } from "@/Controls/IconRail";` to
`import type { PanelId } from "@/Controls/NavRail";`.

### Step 5: Run the new test — confirm it passes

```bash
npm run test -- NavRail
```

### Step 6: Fold vehicle-type toggles into `TogglesPanel`

Add a `VEHICLE_TYPES` section to `TogglesPanel.tsx`, reusing the swatch-color mapping
currently in `apps/ui/src/Map/TypeLegend.tsx` (`--color-vehicle-*` tokens). `TogglesPanel`
needs two new props threaded from `App.tsx`: `hiddenVehicleTypes: Set<VehicleType>` and
`onToggleVehicleType: (type: VehicleType) => void` (both already exist in `App.tsx` today —
`hiddenVehicleTypes`/`toggleVehicleType` from `useVehicleTypeFilter()`, currently only wired
to `TypeLegend`).

Add after the existing `toggles.map(...)` block in `TogglesPanel.tsx`, before the trail-length
conditional:

```tsx
<div className="mt-2 flex flex-col gap-0.5 border-t border-border-soft pt-2">
  <span className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
    Vehicle Types
  </span>
  {VEHICLE_TYPES.map(({ type, label, color }) => {
    const hidden = hiddenVehicleTypes.has(type);
    return (
      <label
        key={type}
        className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors duration-fast ease-standard hover:bg-accent/10"
      >
        <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-sm shadow-raised"
            style={{ backgroundColor: color }}
          />
          {label}
        </span>
        <Switch
          isSelected={!hidden}
          onChange={() => onToggleVehicleType(type)}
          aria-label={`Toggle ${label} visibility`}
        />
      </label>
    );
  })}
</div>
```

Move the `VEHICLE_TYPES` array (type/label/color) from `TypeLegend.tsx` into `TogglesPanel.tsx`
verbatim (it's the exact same domain data — do not redefine it differently).

Update `apps/ui/src/Controls/__tests__/TogglesPanel.test.tsx` — add a test asserting the
"Vehicle Types" section renders with all 5 types and that clicking a switch calls
`onToggleVehicleType` with the right type. Read the existing test file first to match its
render-helper/prop-mocking conventions exactly.

**Run:** `npm run test -- TogglesPanel` — confirm pass.

### Step 7: Delete `TypeLegend.tsx`, remove it from `App.tsx`

- Delete `apps/ui/src/Map/TypeLegend.tsx`.
- In `App.tsx`: remove the `import TypeLegend from "./Map/TypeLegend";` line and the
  `<TypeLegend hiddenVehicleTypes={hiddenVehicleTypes} onToggle={toggleVehicleType} />` JSX
  (currently right after `<FleetLegend .../>`, ~line 366). `FleetLegend` stays — it's a
  different, still-relevant legend (per-fleet colors), out of scope per the design doc.
- Pass `hiddenVehicleTypes`/`toggleVehicleType` into `<TogglesPanel>` instead (where
  `activePanel === "toggles"` renders it, ~line 277-279):

```tsx
{
  activePanel === "toggles" && (
    <TogglesPanel
      modifiers={modifiers}
      onChangeModifiers={onChangeModifiers}
      hiddenVehicleTypes={hiddenVehicleTypes}
      onToggleVehicleType={toggleVehicleType}
    />
  );
}
```

### Step 8: Fold Speed + Clock into `BottomDock`

Delete `SpeedPanel.tsx` and `ClockPanel.tsx`. Remove `"speed"` and `"clock"` from `PanelId`
(already done in Step 3's `NavRail.tsx` rewrite) and remove their `activePanel === "speed"` /
`"clock"` branches + imports from `App.tsx`.

In `BottomDock.tsx`, add a third button cluster between the playback cluster (Start/Reset/Make
Zones) and the record button, using `useClock()` (from `ClockPanel.tsx`, same hook) for the
speed multiplier and `useOptions(300)` (already imported) for `maxSpeed` if a simple display is
wanted. **Scope this conservatively**: the full slider-heavy `ClockPanel`/`SpeedPanel` UIs
(5 sliders + presets) don't fit a transport bar. Ship a compact version:

- A speed-multiplier control: reuse the `SPEED_PRESETS` 1×/60×/360×/3600× buttons from
  `ClockPanel.tsx` (just the button row, not the log-scale slider) — a `Button`-group identical
  in pattern to the existing `SPEEDS` replay-speed buttons already in this file (lines
  172-184), driven by `useClock().setSpeedMultiplier`.
- A clock readout: the `timeStr` display from `ClockPanel.tsx` (`toLocaleTimeString`), styled
  with `tabular-nums`, placed next to the WS/SIM status chips.

Do not port `maxSpeed`/`acceleration`/`deceleration`/`updateInterval`/`adapterSyncInterval`
sliders anywhere — grep the codebase for other consumers of `useOptions` before deleting
`SpeedPanel.tsx` to confirm nothing else depends on that UI existing; if start-options tuning
is still needed, that's a candidate for the (still-existing) Adapter panel, not this plan —
flag it as a follow-up rather than silently dropping the capability. **Do not build this
without first checking**: read `apps/ui/src/hooks/useOptions.ts` usages
(`grep -rn "useOptions" apps/ui/src`) to see if start-options are configured anywhere else
(e.g. a start dialog) — if not, note the gap to the user rather than guessing a new home for
5 sliders.

Add `apps/ui/src/Controls/__tests__/BottomDock.test.tsx` (new — none exists today) covering:
render with default props, clicking Start calls `client.start`, the speed-preset buttons call
`setSpeedMultiplier`. Mock `@/utils/client` and `@/hooks/useClock` the same way other
`Controls/__tests__` files mock hooks — check `TogglesPanel.test.tsx` / `DispatchFooter.test.tsx`
for the project's mocking convention before writing new mocks.

### Step 9: Full verification

```bash
npm run type-check && npm run lint && npm run test
```

Expected: 0 type errors, 0 lint errors, all tests passing (new tests included, count > 794).

### Step 10: Commit

```bash
git add -A -- apps/ui/src/Controls apps/ui/src/hooks/usePanelNavigation.ts apps/ui/src/Map/TypeLegend.tsx apps/ui/src/App.tsx
git commit -m "feat(ui): grouped labeled nav rail, fold speed/clock/legend into dock and visibility panel"
```

(`git add -A --` with explicit pathspecs, not a bare `-A`, keeps the add scoped to this task's
files even though it includes a deletion.)

---

## Task 3: Flatten vehicle list rows + tabular-nums route distance

**Files:**

- Modify: `apps/ui/src/Controls/Vehicles.tsx`
- Test: `apps/ui/src/Controls/__tests__/Vehicles.test.tsx` (new — none exists today)

### Step 1: Write failing tests

Create `apps/ui/src/Controls/__tests__/Vehicles.test.tsx`. Base the render setup (required
props, `useDirectionContext` mock via `@/data/useData`) on how `useDirectionContext` is
provided elsewhere in tests — check `apps/ui/src/data/useData.tsx` for a test provider/wrapper
export, or mock the module directly with `vi.mock("@/data/useData", ...)`.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VehicleList from "../Vehicles";

vi.mock("@/data/useData", () => ({
  useDirectionContext: () => ({ directions: new Map() }),
}));

const baseVehicle = {
  id: "v1",
  name: "Test Vehicle 1",
  type: "car",
  speed: 42,
  visible: true,
  selected: false,
  hovered: false,
} as const;

describe("VehicleList", () => {
  it("renders a row with tabular-nums on both speed and route distance", () => {
    render(
      <VehicleList
        filter=""
        vehicles={[baseVehicle as never]}
        maxSpeed={100}
        onFilterChange={vi.fn()}
        onSelectVehicle={vi.fn()}
        onHoverVehicle={vi.fn()}
        onUnhoverVehicle={vi.fn()}
        vehicleFleetMap={new Map()}
      />
    );
    const row = screen.getByRole("button", { name: /Test Vehicle 1/ });
    const routeText = screen.getByText("No route");
    expect(routeText.className).toContain("tabular-nums");
    expect(row.className).not.toContain("bg-white/[0.03]"); // old card treatment removed
  });
});
```

**Step 2: Run — confirm fail**

```bash
npm run test -- Vehicles.test
```

Expected: FAIL on the `tabular-nums` / `bg-white/[0.03]` assertions (current markup still has
the old classes).

### Step 3: Update row markup in `Vehicles.tsx`

Change the row `className` (line ~200-206) from the bordered-card treatment to flat
hairline-separated rows:

```tsx
className={cn(
  "grid w-full flex-shrink-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 overflow-hidden border-b border-border-soft px-2.5 py-2 text-left transition-colors duration-fast ease-standard hover:bg-white/[0.04] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  isSelected && "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]",
  isDispatchSelected && "bg-accent/5 shadow-[inset_3px_0_0_var(--color-accent)]"
)}
```

Change the type badge (line ~238-242) from a bordered pill to a dot + label, matching the
fleet-color dot pattern already used a few lines above it (line ~230-233) — reuse
`VEHICLE_TYPE_COLORS`-equivalent (import the same `--color-vehicle-*` var mapping used in
`VehiclesLayer.tsx`/`TogglesPanel.tsx` post-Task-2, don't redefine a third copy — extract it
to a small shared module if it doesn't already exist as one, e.g.
`apps/ui/src/lib/vehicleTypeColors.ts` exporting `VEHICLE_TYPE_COLORS` and `VEHICLE_TYPE_LABELS`,
imported by `TogglesPanel.tsx`, `Vehicles.tsx`, and `VehiclesLayer.tsx` alike):

```tsx
{
  vehicle.type && vehicle.type !== "car" && (
    <span className="ml-2 flex flex-shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ backgroundColor: `var(--color-vehicle-${vehicle.type})` }}
      />
      {VEHICLE_TYPE_LABELS[vehicle.type] ?? vehicle.type}
    </span>
  );
}
```

Fix the route-distance text (line ~265-268) to be tabular:

```tsx
<span className="flex items-center gap-3" style={{ gridArea: "route" }}>
  <span className="text-xs tabular-nums text-muted-foreground">
    {formatRouteDistance(routeDistance)}
  </span>
</span>
```

(`"No route"` isn't numeric, but `tabular-nums` is a no-op on non-digit text and this keeps
one class rather than conditionally applying it only when a distance exists — simpler than
splitting the string.)

### Step 4: Run test — confirm pass

```bash
npm run test -- Vehicles.test
```

### Step 5: Full verification + commit

```bash
npm run type-check && npm run lint && npm run test
git add apps/ui/src/Controls/Vehicles.tsx apps/ui/src/Controls/__tests__/Vehicles.test.tsx apps/ui/src/lib/vehicleTypeColors.ts
git commit -m "feat(ui): flatten vehicle list rows, dot-style type badges, tabular route distance"
```

(If you extracted `vehicleTypeColors.ts`, also update `TogglesPanel.tsx` and
`VehiclesLayer.tsx` to import from it and delete their local copies — that cross-file cleanup
belongs in the task that creates the shared module, i.e. this one, since Task 2 already landed
its own local copy in `TogglesPanel.tsx`. Coordinate: this task removes duplication Task 2
introduced.)

---

## Task 4: Right Inspector panel

**Depends on:** Task 2 (needs `App.tsx`'s post-restructure layout as the base).

**Files:**

- Create: `apps/ui/src/Inspector/Inspector.tsx`
- Create: `apps/ui/src/Inspector/__tests__/Inspector.test.tsx`
- Modify: `apps/ui/src/App.tsx`

### Step 1: Write failing tests

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Inspector from "../Inspector";

vi.mock("@/data/useData", () => ({
  useDirectionContext: () => ({ directions: new Map() }),
}));

describe("Inspector", () => {
  it("renders nothing when no vehicle or POI is selected", () => {
    const { container } = render(
      <Inspector vehicle={null} vehicleFleet={undefined} poi={null} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders vehicle details when a vehicle is selected", () => {
    render(
      <Inspector
        vehicle={{ id: "v1", name: "Test Vehicle 1", type: "car", speed: 42 } as never}
        vehicleFleet={undefined}
        poi={null}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Test Vehicle 1")).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Inspector
        vehicle={{ id: "v1", name: "Test Vehicle 1", type: "car", speed: 42 } as never}
        vehicleFleet={undefined}
        poi={null}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run — confirm fail** (module doesn't exist).

### Step 3: Implement `Inspector.tsx`

```tsx
import { cn } from "@/lib/utils";
import type { Fleet, POI, Vehicle } from "@/types";
import { X } from "@/components/Icons";
import { Button } from "@/components/Inputs";
import { useDirectionContext } from "@/data/useData";

interface InspectorProps {
  vehicle: Vehicle | null;
  vehicleFleet: Fleet | undefined;
  poi: POI | null;
  onClose: () => void;
}

export default function Inspector({ vehicle, vehicleFleet, poi, onClose }: InspectorProps) {
  const { directions } = useDirectionContext();
  const entity = vehicle ?? poi;
  if (!entity) return null;

  const route = vehicle ? directions.get(vehicle.id)?.route : undefined;

  return (
    <aside
      className={cn(
        "absolute bottom-0 top-0 right-0 z-30 w-[clamp(280px,26vw,340px)]",
        "flex flex-col overflow-hidden border-l border-border surface-glass shadow-elevated backdrop-blur-2xl",
        "animate-fade-up"
      )}
      aria-label="Inspector"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {vehicle ? vehicle.name : poi?.name}
          </h2>
          {vehicleFleet && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{vehicleFleet.name}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close inspector">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {vehicle && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Speed</dt>
            <dd className="text-right tabular-nums text-foreground">
              {Math.round(vehicle.speed)} km/h
            </dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-right capitalize text-foreground">{vehicle.type}</dd>
            {route && (
              <>
                <dt className="text-muted-foreground">Route</dt>
                <dd className="text-right tabular-nums text-foreground">
                  {route.distance.toFixed(1)} km
                </dd>
              </>
            )}
          </dl>
        )}
        {poi && !vehicle && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-right capitalize text-foreground">{poi.type}</dd>
          </dl>
        )}
      </div>
    </aside>
  );
}
```

Check `apps/ui/src/components/Inputs.tsx` for `Button`'s actual `size="icon"` support and
`X`'s export name in `@/components/Icons` (likely `Close` or `X` — grep
`export const X\|export const Close` before assuming) and adjust the import to match.
Check `POI`'s actual field name for its type (`type` assumed above — verify against the
`POI` shape in `@moveet/shared-types`) and `Route`'s distance field name (`distance`, per
existing usage in `Vehicles.tsx`'s `formatRouteDistance`) before finalizing.

**Step 4: Run tests — confirm pass.**

### Step 5: Wire into `App.tsx`

Add the import and render it as a sibling to the existing `aside` (left panel), inside the map
`ErrorBoundary`'s flex container so it participates in the same flex row, OR as an absolutely
positioned sibling like the left `aside` — match the left panel's actual positioning strategy
(`absolute bottom-0 top-0 left-14 ...`) with a mirrored right-side version rather than
introducing a different layout primitive:

```tsx
import Inspector from "./Inspector/Inspector";
```

After the closing `</aside>` of the left panel (~line 317) and before the map's
`ErrorBoundary`, or as a new absolutely-positioned element inside the map's relative container
(next to `<ConnectionStatus>`/`<LoadingOverlay>`) — place it inside
`<div className="relative flex min-h-0 min-w-0 flex-1">` (the map container div, ~line 320) so
it overlays the map on its right edge without disturbing the left panel's layout:

```tsx
<Inspector
  vehicle={vehicles.find((v) => v.id === filters.selected) ?? null}
  vehicleFleet={filters.selected ? vehicleFleetMap.get(filters.selected) : undefined}
  poi={selectedItem && isPOI(selectedItem) ? selectedItem : null}
  onClose={() => {
    if (filters.selected) onUnselectVehicle();
    if (selectedItem) setSelectedItem(null);
  }}
/>
```

Import `isPOI` from `@/utils/typeGuards`. Verify `onUnselectVehicle` and `setSelectedItem` are
both already in scope in `App.tsx` (they are, per current `useVehicles()`/
`useMapInteractions()` destructuring).

### Step 6: Selection dimming hookup check

Confirm `MapView`/`VehiclesLayer` already receives `filters.selected` as `selectedId` (it does,
per current `App.tsx` → `Map.tsx` → `VehiclesLayer.tsx` prop chain) — no new prop threading
needed for Task 5's dimming to activate once the Inspector is open; the Inspector is a pure
consumer of existing selection state, not a new source of it.

### Step 7: Full verification

```bash
npm run type-check && npm run lint && npm run test
```

Manually verify in the browser (dev servers already running on 5010/5012): click a vehicle in
the list or on the map, confirm the Inspector slides in on the right with name/speed/type/route,
click the close button, confirm it closes and the vehicle deselects.

### Step 8: Commit

```bash
git add apps/ui/src/Inspector apps/ui/src/App.tsx
git commit -m "feat(ui): add on-demand right inspector panel for selected vehicle/POI"
```

---

## Task 5: Dim non-selected vehicles when one is selected

**Files:**

- Modify: `apps/ui/src/Map/Vehicle/VehiclesLayer.tsx`
- Test: `apps/ui/src/Map/Vehicle/VehiclesLayer.test.tsx` (new — sibling file, matching this
  directory's existing `vehicleIconAtlas.test.ts` co-location convention, not a `__tests__/`
  subfolder)

### Step 1: Write a failing test asserting constructed layer props (per the `deckgl-map-layers`

skill — jsdom has no WebGL, assert on props, not pixels)

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const registerLayers = vi.fn();
vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (...args: unknown[]) => registerLayers(...args),
}));
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    viewport: { unproject: (p: number[]) => p },
    getZoom: () => 12,
    getBoundingBox: () => ({ west: -1, east: 1, north: 1, south: -1 }),
  }),
}));
vi.mock("../../hooks/vehicleStore", () => ({
  vehicleStore: {
    getAll: () => [
      { id: "v1", position: [0, 0], heading: 0, speed: 40, type: "car" },
      { id: "v2", position: [0.01, 0.01], heading: 0, speed: 40, type: "car" },
    ],
    subscribe: () => () => {},
  },
}));

import VehiclesLayer from "./VehiclesLayer";

describe("VehiclesLayer selection dimming", () => {
  it("reduces icon alpha for non-selected vehicles when selectedId is set", async () => {
    render(
      <VehiclesLayer
        scale={1}
        vehicleFleetMap={new Map()}
        hiddenFleetIds={new Set()}
        hiddenVehicleTypes={new Set()}
        selectedId="v1"
        onClick={vi.fn()}
      />
    );
    await new Promise((r) => requestAnimationFrame(r));
    const [, layers] = registerLayers.mock.calls.at(-1)!;
    const vehiclesLayer = layers.find((l: { id: string }) => l.id === "vehicles");
    const data = vehiclesLayer.props.data as { id: string; iconColor: number[] }[];
    const selected = data.find((d) => d.id === "v1")!;
    const other = data.find((d) => d.id === "v2")!;
    expect(other.iconColor[3]).toBeLessThan(selected.iconColor[3]);
  });
});
```

Check the real shape of `vehicleStore`'s public API (`getAll`/`subscribe` names assumed —
verify against `apps/ui/src/hooks/vehicleStore.ts`) and adjust the mock before running; this
is the trickiest test to get the mocking surface right for since the component does a lot in
one RAF-driven effect. If mocking `requestAnimationFrame`-driven internals proves too brittle,
an acceptable fallback is a narrower **unit test extracted around the alpha-computation logic
itself** — pull the dimming calculation into a small pure exported function (see Step 2) and
unit-test that directly instead of round-tripping through the full component + RAF loop.

### Step 2: Implement as a small pure helper + wire into the RAF loop

Add near the other constants (~line 163, after `MOVING_ICON_ALPHA`):

```ts
const DIMMED_ALPHA_FACTOR = 0.5;

/** Exported for direct unit testing without round-tripping the RAF loop. */
export function computeIconAlpha(
  speedKmh: number,
  vehicleId: string,
  currentSelectedId: string | undefined
): number {
  const base = speedKmh < IDLE_SPEED_KMH ? IDLE_ICON_ALPHA : MOVING_ICON_ALPHA;
  if (currentSelectedId && vehicleId !== currentSelectedId) {
    return Math.round(base * DIMMED_ALPHA_FACTOR);
  }
  return base;
}
```

Replace the inline alpha ternary at line ~484-489:

```ts
vehicles.push({
  id: v.id,
  position: [lng, lat],
  angle: (-heading * 180) / Math.PI,
  icon: atlasManager.register(vehicleType, color),
  isSelected: v.id === currentSelectedId,
  isHovered: v.id === currentHoveredId,
  iconColor: [255, 255, 255, computeIconAlpha(v.speed ?? 0, v.id, currentSelectedId)],
});
```

No `updateTriggers` change needed: `iconColor` is baked into each `vehicleData` entry (rebuilt
every RAF tick already, per the existing comment at line ~576-578), and `getColor: (d) =>
d.iconColor` reads it straight from data — deck.gl re-evaluates whenever the `data` array
reference changes, which it already does every frame. Verify this by reading the full RAF loop
once more before changing anything — do not add a redundant `updateTriggers.getColor` entry
that would fight the existing per-frame data replacement pattern.

### Step 3: Run tests — confirm pass

```bash
npm run test -- VehiclesLayer
```

### Step 4: Manual verification

With dev servers running, select a vehicle (click it in the list or on the map) and confirm
other vehicles visibly dim; deselect (click the map background) and confirm all vehicles
return to normal opacity.

### Step 5: Full verification + commit

```bash
npm run type-check && npm run lint && npm run test
git add apps/ui/src/Map/Vehicle/VehiclesLayer.tsx apps/ui/src/Map/Vehicle/VehiclesLayer.test.tsx
git commit -m "feat(ui): dim non-selected vehicles on the map when one is selected"
```

---

## Final integration pass (after all tasks land)

1. `npm run type-check && npm run lint && npm run test && npm run build` in `apps/ui` — full
   green build, not just per-task green.
2. Manual browser pass covering the golden path: load app → nav rail shows grouped labeled
   items → open Vehicles → click a vehicle → Inspector opens on the right, map dims other
   vehicles → open Visibility → toggle a vehicle type off, confirm it disappears from the map
   → check the transport bar's speed presets and clock readout → open each remaining panel
   (Fleets, Incidents, Geofences, Recordings, Scenarios, Analytics, Adapter) to confirm none
   regressed from the `PanelId`/`App.tsx` changes.
3. Update `apps/ui/CLAUDE.md`'s Controls list (currently says `IconRail + sliding panels
(vehicles, fleets, incidents, recordings, scenarios, toggles, speed, clock, analytics,
geofences, adapter) + BottomDock`) to reflect the new `NavRail` name, the removed
   `speed`/`clock` panel ids, and the new `src/Inspector/` feature folder.
4. Follow `superpowers:finishing-a-development-branch` to decide merge/PR path back to `main`.
