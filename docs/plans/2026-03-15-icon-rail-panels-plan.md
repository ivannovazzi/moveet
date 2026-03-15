# Icon Rail + Multi-Panel Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolith left sidebar with an icon rail + swappable panel system where each function (vehicles, fleets, incidents, recordings) gets its own dedicated panel.

**Architecture:** A 48px vertical icon rail is always visible on the left edge. Clicking an icon opens a ~300px panel to its right. Only one panel is open at a time. Clicking the active icon collapses the panel. State is a single `activePanel` variable.

**Tech Stack:** React, TypeScript, CSS Modules, classnames

---

### Task 1: Create IconRail Component + State

**Files:**
- Create: `apps/ui/src/Controls/IconRail.tsx`
- Create: `apps/ui/src/Controls/IconRail.module.css`
- Modify: `apps/ui/src/App.tsx`
- Modify: `apps/ui/src/App.module.css`

**Step 1: Create icon SVG components**

Add four new icon components to `apps/ui/src/components/Icons.tsx`:

```tsx
export function CarIcon(props: SVGProps) {
  return (
    <svg {...props} viewBox="0 0 24 24">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
    </svg>
  );
}

export function LayersIcon(props: SVGProps) {
  return (
    <svg {...props} viewBox="0 0 24 24">
      <path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z" />
    </svg>
  );
}

export function AlertIcon(props: SVGProps) {
  return (
    <svg {...props} viewBox="0 0 24 24">
      <path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2zm0-6h2v4h-2z" />
    </svg>
  );
}

export function RecordCircleIcon(props: SVGProps) {
  return (
    <svg {...props} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}
```

**Step 2: Create IconRail component**

Create `apps/ui/src/Controls/IconRail.tsx`:

```tsx
import classNames from "classnames";
import { CarIcon, LayersIcon, AlertIcon, RecordCircleIcon } from "@/components/Icons";
import styles from "./IconRail.module.css";

export type PanelId = "vehicles" | "fleets" | "incidents" | "recordings";

interface IconRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

const items: { id: PanelId; Icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
  { id: "fleets", Icon: LayersIcon, label: "Fleets" },
  { id: "incidents", Icon: AlertIcon, label: "Incidents" },
  { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
];

export default function IconRail({ activePanel, onPanelChange, incidentCount }: IconRailProps) {
  return (
    <nav className={styles.rail} aria-label="Sidebar navigation">
      {items.map(({ id, Icon, label }) => (
        <button
          key={id}
          type="button"
          className={classNames(styles.railButton, {
            [styles.railButtonActive]: activePanel === id,
          })}
          onClick={() => onPanelChange(activePanel === id ? null : id)}
          aria-label={label}
          aria-pressed={activePanel === id}
          title={label}
        >
          <Icon className={styles.railIcon} />
          {id === "incidents" && incidentCount != null && incidentCount > 0 && (
            <span className={styles.badge}>{incidentCount > 9 ? "9+" : incidentCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
```

**Step 3: Create IconRail styles**

Create `apps/ui/src/Controls/IconRail.module.css`:

```css
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 48px;
  flex-shrink: 0;
  padding: var(--space-3) 0;
  gap: var(--space-2);
  background: rgba(7, 9, 13, 0.74);
  border-right: 1px solid var(--color-overlay-1);
  z-index: 31;
}

.railButton {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-gray-light);
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}

.railButton:hover {
  background: var(--surface-bg-hover);
  color: var(--color-white);
}

.railButtonActive {
  background: var(--surface-bg-active);
  color: var(--color-white);
  box-shadow: inset 2px 0 0 var(--color-accent);
}

.railIcon {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: var(--radius-full);
  background: #f44336;
  color: var(--color-white);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
}
```

**Step 4: Update App state — replace `isVehiclePanelOpen` with `activePanel`**

In `apps/ui/src/App.tsx`, replace:

```tsx
const [isVehiclePanelOpen, setVehiclePanelOpen] = useState(false);
```

with:

```tsx
const [activePanel, setActivePanel] = useState<PanelId | null>(null);
```

Add import at top:

```tsx
import IconRail from "./Controls/IconRail";
import type { PanelId } from "./Controls/IconRail";
```

**Step 5: Update App layout — insert IconRail + conditional panel rendering**

Replace the entire `<aside>` block for the left panel (lines 375-437) with:

```tsx
<IconRail
  activePanel={activePanel}
  onPanelChange={setActivePanel}
  incidentCount={incidents.incidents.length}
/>
<aside
  className={classNames(styles.panelRail, styles.leftPanel, {
    [styles.leftPanelOpen]: activePanel !== null,
  })}
  aria-hidden={activePanel === null}
>
  <div className={styles.panelInner}>
    {activePanel === "vehicles" && (
      <>
        <button
          type="button"
          className={classNames(styles.dispatchToggle, {
            [styles.dispatchToggleActive]: dispatchMode,
          })}
          onClick={() => {
            setDispatchMode((prev) => {
              if (prev) {
                setSelectedForDispatch([]);
                setAssignments([]);
                setResults([]);
                setDispatching(false);
              }
              return !prev;
            });
          }}
        >
          {dispatchMode ? "Exit Dispatch" : "Dispatch"}
        </button>
        <Vehicles
          filter={filters.filter}
          onFilterChange={onFilterChange}
          vehicles={vehicles}
          onSelectVehicle={onSelectVehicle}
          onHoverVehicle={onHoverVehicle}
          onUnhoverVehicle={onUnhoverVehicle}
          maxSpeed={maxSpeedRef.current}
          fleets={fleets}
          onAssignVehicle={assignVehicle}
          onUnassignVehicle={unassignVehicle}
          dispatchState={dispatchState}
          selectedForDispatch={selectedForDispatch}
          onToggleVehicleForDispatch={onToggleVehicleForDispatch}
          assignments={assignments}
          results={results}
        />
        <DispatchFooter
          state={dispatchState}
          selectedCount={selectedForDispatch.length}
          assignments={assignments}
          results={results}
          onDispatch={handleDispatch}
          onClear={handleDone}
          onDone={handleDone}
          onRetryFailed={handleRetryFailed}
          dispatching={dispatching}
        />
      </>
    )}
    {activePanel === "fleets" && (
      <Fleets fleets={fleets} onCreateFleet={createFleet} onDeleteFleet={deleteFleet} />
    )}
    {activePanel === "incidents" && (
      <Incidents
        incidents={incidents.incidents}
        createRandom={incidents.createRandom}
        remove={incidents.remove}
      />
    )}
    {activePanel === "recordings" && (
      <RecordReplay recording={recording} onStartReplay={replay.startReplay} />
    )}
  </div>
</aside>
```

**Step 6: Update App.module.css for icon rail layout**

The `.content` div needs to accommodate the icon rail. The icon rail sits in normal flow (not absolute) while the panel overlays. Update `.content`:

No change needed to `.content` — the icon rail will sit in normal flow and the panel will remain absolute. But we need the panel to offset by 48px so it doesn't overlap the rail:

```css
.leftPanel {
  left: 48px; /* offset by icon rail width */
  width: clamp(248px, 22vw, 304px);
  transform: translateX(calc(-100% - 20px));
}
```

**Step 7: Update ControlPanel toggle**

In `Controls.tsx`, the vehicle count button currently toggles `isVehiclePanelOpen`. Update its `onClick` and related props to work with `activePanel`:

In `App.tsx`, update the ControlPanel props:
- Change `isVehiclePanelOpen` to `activePanel === "vehicles"`
- Change `onToggleVehiclePanel` to toggle `activePanel` to `"vehicles"` or `null`

```tsx
isVehiclePanelOpen={activePanel === "vehicles"}
onToggleVehiclePanel={() => setActivePanel((prev) => prev === "vehicles" ? null : "vehicles")}
```

**Step 8: Update dispatch auto-open**

Replace the auto-open effect (line 307-311):

```tsx
useEffect(() => {
  if (dispatchMode) {
    setActivePanel("vehicles");
  }
}, [dispatchMode]);
```

**Step 9: Run type check**

Run: `cd apps/ui && npx tsc --noEmit`
Expected: No errors

**Step 10: Commit**

```bash
git add apps/ui/src/Controls/IconRail.tsx apps/ui/src/Controls/IconRail.module.css apps/ui/src/components/Icons.tsx apps/ui/src/App.tsx apps/ui/src/App.module.css
git commit -m "feat(ui): add icon rail with multi-panel sidebar layout"
```

---

### Task 2: Remove Fleet Dropdown from Vehicle Cards

**Files:**
- Modify: `apps/ui/src/Controls/Vehicles.tsx`
- Modify: `apps/ui/src/Controls/Vehicles.module.css`
- Modify: `apps/ui/src/App.tsx`

**Step 1: Remove fleet-related props from VehicleList**

In `Vehicles.tsx`, remove from `VehicleListProps`:

```tsx
fleets: Fleet[];
onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
```

Remove the `Fleet` import from the type import line. Remove `fleets`, `onAssignVehicle`, `onUnassignVehicle` from the destructured props.

**Step 2: Remove fleet dropdown from vehicle card**

In the vehicle card's route row, remove the entire `{!hideFleetDropdown && (...)}` block (lines 208-227). Also remove the `hideFleetDropdown` variable (line 102) and `vehicleFleet` lookup used only for the dropdown (line 148 — but keep it for the fleet dot color).

Actually, `vehicleFleet` is also used for the fleet dot color (line 185). Keep the lookup but remove the dropdown.

Remove:
- The `const hideFleetDropdown = ...` line (102)
- The `<select>` block inside `.routeRow` (lines 208-227)

**Step 3: Remove "Fleet overview" eyebrow**

Remove line 107: `<div className={styles.panelEyebrow}>Fleet overview</div>`

**Step 4: Remove unused CSS**

In `Vehicles.module.css`, remove the `.fleetSelect` rule and `.panelEyebrow` rule.

**Step 5: Update App.tsx — remove fleet props from Vehicles**

In `App.tsx`, remove the `fleets`, `onAssignVehicle`, `onUnassignVehicle` props from the `<Vehicles>` usage. The fleet dot still needs `vehicleFleetMap` — but actually, `Vehicles.tsx` currently does its own fleet lookup (line 148) using the `fleets` prop. Since we're removing the dropdown but keeping the dot, we need to keep `fleets` for the dot.

Actually, let's keep `fleets` just for the fleet dot coloring. Only remove `onAssignVehicle` and `onUnassignVehicle` props.

Revised: Remove from props interface:
```tsx
onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
```

Remove from App.tsx:
```tsx
onAssignVehicle={assignVehicle}
onUnassignVehicle={unassignVehicle}
```

**Step 6: Run type check**

Run: `cd apps/ui && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/ui/src/Controls/Vehicles.tsx apps/ui/src/Controls/Vehicles.module.css apps/ui/src/App.tsx
git commit -m "feat(ui): remove fleet dropdown from vehicle cards"
```

---

### Task 3: Make Fleets Panel Full-Height with Section Styling

**Files:**
- Modify: `apps/ui/src/Controls/Fleets.tsx`
- Modify: `apps/ui/src/Controls/Fleets.module.css`

**Step 1: Add panel header styling to Fleets**

The Fleets component currently uses a `.section` wrapper designed for being one section among many. Now it's a full panel. Update the structure to use a sticky header + scrollable body pattern matching the Vehicles panel.

Update `Fleets.tsx` — wrap in a fragment with sticky header and scrollable body:

```tsx
export default function Fleets({ fleets, onCreateFleet, onDeleteFleet }: FleetsProps) {
  // ... existing state and handlers ...

  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>Fleets</h2>
        {fleets.length < 10 && (
          <button className={styles.addButton} onClick={() => setIsAdding(true)} type="button">
            + New
          </button>
        )}
      </div>

      <div className={styles.body}>
        {fleets.length === 0 && !isAdding && <div className={styles.empty}>No fleets defined</div>}

        <div className={styles.fleetList}>
          {fleets.map((fleet) => (
            // ... existing fleet items unchanged ...
          ))}
        </div>

        {isAdding && (
          <input ... /> // existing input unchanged
        )}
      </div>
    </>
  );
}
```

**Step 2: Update Fleets.module.css**

Replace `.section` with `.header` (sticky) and `.body` (scrollable flex:1):

```css
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--color-overlay-1);
  flex-shrink: 0;
}

.title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-white);
  margin: 0;
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-6);
}
```

**Step 3: Run type check**

Run: `cd apps/ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/Fleets.tsx apps/ui/src/Controls/Fleets.module.css
git commit -m "feat(ui): update fleets panel to full-height standalone layout"
```

---

### Task 4: Make Incidents Panel Full-Height with Section Styling

**Files:**
- Modify: `apps/ui/src/Controls/Incidents.tsx`
- Modify: `apps/ui/src/Controls/Incidents.module.css`

**Step 1: Update Incidents component structure**

Same pattern as Fleets — wrap in fragment with sticky header and scrollable body:

```tsx
return (
  <>
    <div className={styles.header}>
      <h2 className={styles.title}>Incidents</h2>
      <label className={styles.autoLabel}>
        <Switch checked={autoGenerate} onChange={toggleAutoGenerate} aria-label="Auto-generate incidents" />
        <span className={styles.autoText}>Auto</span>
      </label>
      <button className={styles.addButton} onClick={createRandom} type="button">
        +
      </button>
    </div>

    <div className={styles.body}>
      {incidents.length === 0 && <div className={styles.empty}>No active incidents</div>}
      <div className={styles.list}>
        {incidents.map((incident) => (
          // ... existing incident items unchanged ...
        ))}
      </div>
    </div>
  </>
);
```

**Step 2: Update Incidents.module.css**

Replace `.section` with `.header` and `.body` using the same sticky header + scroll body pattern.

```css
.header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--color-overlay-1);
  flex-shrink: 0;
}

.title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-white);
  margin: 0;
  margin-right: auto;
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-6);
}
```

Remove the old `.section` rule and the `max-height` constraint on `.list` (it was 260px, no longer needed since the panel is full-height scrollable).

**Step 3: Run type check**

Run: `cd apps/ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/Incidents.tsx apps/ui/src/Controls/Incidents.module.css
git commit -m "feat(ui): update incidents panel to full-height standalone layout"
```

---

### Task 5: Make Recordings Panel Full-Height with Section Styling

**Files:**
- Modify: `apps/ui/src/Controls/RecordReplay.tsx`
- Modify: `apps/ui/src/Controls/RecordReplay.module.css`

**Step 1: Update RecordReplay component structure**

Same pattern:

```tsx
return (
  <>
    <div className={styles.header}>
      <h2 className={styles.title}>Recordings</h2>
    </div>

    <div className={styles.body}>
      {/* Record section */}
      <div className={styles.recordRow}>
        <button ... />  {/* existing record toggle button */}
        {isRecording && <span className={styles.elapsed}>{formatTime(elapsed)}</span>}
      </div>

      {/* Recordings list */}
      <div className={styles.listHeader}>
        <span className={styles.listTitle}>Saved</span>
      </div>

      {recordings.length === 0 ? (
        <div className={styles.empty}>No recordings yet</div>
      ) : (
        <div className={styles.recordingList}>
          {recordings.map(...)} {/* existing */}
        </div>
      )}
    </div>
  </>
);
```

**Step 2: Update RecordReplay.module.css**

Replace `.section` and `.sectionHeader` with `.header`, `.body`, `.listHeader`, `.listTitle` using the same panel pattern.

**Step 3: Run type check**

Run: `cd apps/ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/RecordReplay.tsx apps/ui/src/Controls/RecordReplay.module.css
git commit -m "feat(ui): update recordings panel to full-height standalone layout"
```

---

### Task 6: Visual Polish and Final Cleanup

**Files:**
- Modify: `apps/ui/src/App.module.css`
- Modify: `apps/ui/src/Controls/Vehicles.tsx`
- Modify: `apps/ui/src/Controls/Vehicles.module.css`

**Step 1: Ensure panel transitions work with icon rail**

Verify the `.leftPanel` offset is correct (48px left offset). The panel should slide in from the left edge of the icon rail, not the screen edge.

**Step 2: Remove orphaned CSS**

In `Vehicles.module.css`, remove:
- `.panelEyebrow` styles (if not removed in Task 2)

In `App.module.css`, verify no orphaned styles from the old sidebar.

**Step 3: Run type check**

Run: `cd apps/ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Visual test**

Run: `cd apps/ui && npx vite --host`

Verify:
- Icon rail visible on left edge with 4 icons
- Clicking each icon opens the corresponding panel
- Clicking active icon closes the panel
- Vehicle panel shows dispatch toggle + vehicle list + dispatch footer
- Fleets panel shows fleet list with create/delete
- Incidents panel shows incident list with auto-toggle
- Recordings panel shows record button and file list
- Panel transitions are smooth
- Dispatch mode auto-opens vehicles panel

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): polish icon rail panels and clean up orphaned styles"
```
