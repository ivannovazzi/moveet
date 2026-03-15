# Dock & Rail Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the top ControlPanel and ReplayBar with a centered bottom dock (mode-adaptive) and expand the icon rail from 4 to 7 entries with new Toggles, Speed, and Adapter panels.

**Architecture:** The top bar is removed entirely. A new `BottomDock` component renders centered at the bottom of the map, showing live controls or replay controls based on `replayStatus.mode`. Three new left panels (Toggles, Speed, Adapter) join the existing four, all controlled through the expanded icon rail.

**Tech Stack:** React, TypeScript, CSS Modules, classnames, existing hooks (`useOptions`, `useReplay`), existing `Switch`/`Range` input components.

---

### Task 1: Create BottomDock — Live Mode

**Files:**
- Create: `apps/ui/src/Controls/BottomDock.tsx`
- Create: `apps/ui/src/Controls/BottomDock.module.css`

**Step 1: Create BottomDock component with live mode controls**

The dock shows play/pause, reset, make-zones, WS/SIM status chips, and vehicle count. It receives `replayStatus` to decide which mode to render.

```tsx
// apps/ui/src/Controls/BottomDock.tsx
import { useCallback } from "react";
import classNames from "classnames";
import client from "@/utils/client";
import type { ReplayStatus, SimulationStatus, StartOptions } from "@/types";
import { Flame, Pause, Play, Reset, Stop } from "@/components/Icons";
import { useOptions } from "@/hooks/useOptions";
import styles from "./BottomDock.module.css";

interface BottomDockProps {
  status: SimulationStatus;
  connected: boolean;
  vehicleCount: number;
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
}

export default function BottomDock({
  status,
  connected,
  vehicleCount,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onStartReplay,
}: BottomDockProps) {
  const { options } = useOptions(300);

  const handleStart = useCallback(() => client.start(options), [options]);
  const handleReset = useCallback(async () => { await client.reset(); }, []);

  if (replayStatus.mode === "replay") {
    return (
      <ReplayDock
        replayStatus={replayStatus}
        onPauseReplay={onPauseReplay}
        onResumeReplay={onResumeReplay}
        onStopReplay={onStopReplay}
        onSeekReplay={onSeekReplay}
        onStartReplay={onStartReplay}
      />
    );
  }

  const statusChips = [
    { key: "ws", label: "WS", active: connected },
    { key: "sim", label: "SIM", active: status.running },
  ] as const;

  return (
    <div className={styles.dock}>
      <div className={styles.group}>
        <button
          type="button"
          onClick={status.running ? client.stop : handleStart}
          className={classNames(styles.dockBtn, { [styles.dockBtnActive]: status.running })}
          aria-label={status.running ? "Pause" : "Start"}
        >
          {status.running ? <Pause className={styles.btnIcon} /> : <Play className={styles.btnIcon} />}
        </button>
        <button type="button" onClick={handleReset} className={styles.dockBtn} aria-label="Reset">
          <Reset className={styles.btnIcon} />
        </button>
        <button type="button" onClick={client.makeHeatzones} className={styles.dockBtn} aria-label="Make zones">
          <Flame className={styles.btnIcon} />
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        {statusChips.map(({ key, label, active }) => (
          <span key={key} className={classNames(styles.chip, { [styles.chipActive]: active })}>
            <span className={classNames(styles.led, { [styles.ledOn]: active })} />
            <span className={styles.chipLabel}>{label}</span>
          </span>
        ))}
      </div>

      <div className={styles.divider} />

      <span className={styles.vehicleCount}>
        <span className={styles.vehicleCountValue}>{vehicleCount}</span>
        <span className={styles.vehicleCountLabel}>fleet</span>
      </span>
    </div>
  );
}
```

**Note:** `ReplayDock` is a private sub-component defined in the same file — see Task 2.

**Step 2: Create BottomDock CSS module**

```css
/* apps/ui/src/Controls/BottomDock.module.css */
.dock {
  position: absolute;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 44px;
  padding: 0 var(--space-4);
  background: rgba(7, 9, 13, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-overlay-1);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.group {
  display: flex;
  align-items: center;
  gap: 1px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--color-overlay-1);
  flex-shrink: 0;
}

.dockBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--surface-bg);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.dockBtn:hover {
  background: var(--surface-bg-hover);
}

.dockBtnActive {
  background: rgba(68, 204, 68, 0.12);
}

.dockBtnActive:hover {
  background: rgba(68, 204, 68, 0.2);
}

.btnIcon {
  width: 13px;
  height: 13px;
  fill: var(--color-gray-light);
}

.dockBtnActive .btnIcon {
  fill: #4c4;
}

/* ── Status chips ── */

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 28px;
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-gray-light);
}

.chipActive {
  color: var(--color-gray-lightest);
}

.chipLabel {
  letter-spacing: 0.3px;
  text-transform: uppercase;
  opacity: 0.55;
}

.chipActive .chipLabel {
  opacity: 0.85;
}

.led {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--color-gray);
  flex-shrink: 0;
}

.ledOn {
  background-color: #4c4;
  box-shadow: 0 0 4px #4c4;
}

/* ── Vehicle count ── */

.vehicleCount {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
  color: var(--color-gray-lightest);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.vehicleCountValue {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-white);
}

.vehicleCountLabel {
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.55;
}

/* ── Replay mode ── */

.transportGroup {
  display: flex;
  align-items: center;
  gap: 1px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.stopBtn {
  composes: dockBtn;
}

.stopBtn:hover {
  background: rgba(255, 68, 68, 0.12);
}

.stopBtn:hover .btnIcon {
  fill: #f44;
}

.progressWrap {
  flex: 0 1 280px;
  min-width: 80px;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  cursor: pointer;
  position: relative;
}

.progressFill {
  height: 100%;
  background: var(--color-accent, rgba(59, 130, 246, 0.7));
  border-radius: 999px;
  transition: width 1s linear;
  pointer-events: none;
}

.time {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-gray-light);
  white-space: nowrap;
  flex-shrink: 0;
}

.speedGroup {
  display: flex;
  gap: 1px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}

.speedBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 var(--space-3);
  border: none;
  background: var(--surface-bg);
  color: var(--color-gray-light);
  font-size: var(--text-xs);
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.speedBtn:hover {
  background: var(--surface-bg-hover);
}

.speedBtnActive {
  background: rgba(57, 153, 255, 0.14);
  color: var(--color-white);
}

.fileName {
  max-width: 120px;
  font-size: var(--text-xs);
  color: var(--color-gray);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}
```

**Step 3: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds (BottomDock not yet wired into App)

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/BottomDock.tsx apps/ui/src/Controls/BottomDock.module.css
git commit -m "feat(ui): add BottomDock component with live mode controls"
```

---

### Task 2: Add Replay Mode to BottomDock

**Files:**
- Modify: `apps/ui/src/Controls/BottomDock.tsx`

**Step 1: Add ReplayDock sub-component**

Add the `ReplayDock` component (private, same file) that handles replay transport, progress, seeking, and speed. Port the `useInterpolatedProgress` hook from `ReplayBar.tsx` and the `formatTime` helper.

Add these above the `BottomDock` export in `BottomDock.tsx`:

```tsx
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useInterpolatedProgress(replayStatus: ReplayStatus) {
  const duration = replayStatus.duration ?? 0;
  const serverTime = replayStatus.currentTime ?? 0;
  const speed = replayStatus.speed ?? 1;
  const isPlaying = replayStatus.mode === "replay" && !replayStatus.paused;

  const [displayTime, setDisplayTime] = useState(serverTime);
  const anchorRef = useRef({ serverTime, wall: Date.now() });

  useEffect(() => {
    anchorRef.current = { serverTime, wall: Date.now() };
    setDisplayTime(serverTime);
  }, [serverTime]);

  useEffect(() => {
    if (!isPlaying || duration <= 0) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - anchorRef.current.wall;
      const interpolated = anchorRef.current.serverTime + elapsed * speed;
      setDisplayTime(Math.min(interpolated, duration));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, speed, duration]);

  const progress = duration > 0 ? Math.min(displayTime / duration, 1) : 0;
  return { displayTime, progress, duration };
}

const SPEEDS = [1, 2, 4] as const;

interface ReplayDockProps {
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
}

function ReplayDock({
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onStartReplay,
}: ReplayDockProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const { displayTime, progress, duration } = useInterpolatedProgress(replayStatus);

  const handlePlayPause = useCallback(async () => {
    if (replayStatus.paused) {
      await onResumeReplay();
    } else {
      await onPauseReplay();
    }
  }, [replayStatus.paused, onPauseReplay, onResumeReplay]);

  const handleProgressClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || duration <= 0) return;
      const rect = progressRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const timestamp = (clickX / rect.width) * duration;
      await onSeekReplay(timestamp);
    },
    [duration, onSeekReplay]
  );

  const handleSpeedChange = useCallback(
    async (speed: number) => {
      if (replayStatus.file) {
        await onStartReplay(replayStatus.file, speed);
      }
    },
    [replayStatus.file, onStartReplay]
  );

  const fileName = replayStatus.file?.replace(/^recordings\//, "");

  return (
    <div className={styles.dock}>
      <span className={styles.fileName} title={fileName}>{fileName}</span>

      <div className={styles.transportGroup}>
        <button
          type="button"
          className={styles.dockBtn}
          onClick={handlePlayPause}
          aria-label={replayStatus.paused ? "Resume" : "Pause"}
        >
          {replayStatus.paused ? (
            <Play className={styles.btnIcon} />
          ) : (
            <Pause className={styles.btnIcon} />
          )}
        </button>
        <button
          type="button"
          className={styles.stopBtn}
          onClick={onStopReplay}
          aria-label="Stop replay"
        >
          <Stop className={styles.btnIcon} />
        </button>
      </div>

      <div className={styles.divider} />

      <div ref={progressRef} className={styles.progressWrap} onClick={handleProgressClick}>
        <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
      </div>

      <span className={styles.time}>
        {formatTime(displayTime / 1000)} / {formatTime(duration / 1000)}
      </span>

      <div className={styles.divider} />

      <div className={styles.speedGroup}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={classNames(styles.speedBtn, {
              [styles.speedBtnActive]: (replayStatus.speed ?? 1) === s,
            })}
            onClick={() => handleSpeedChange(s)}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
```

Also add `useState, useEffect, useRef` to the existing `useCallback` import at the top:
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
```

**Step 2: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/ui/src/Controls/BottomDock.tsx
git commit -m "feat(ui): add replay mode to BottomDock"
```

---

### Task 3: Create TogglesPanel

**Files:**
- Create: `apps/ui/src/Controls/TogglesPanel.tsx`
- Create: `apps/ui/src/Controls/TogglesPanel.module.css`

**Step 1: Create TogglesPanel component**

```tsx
// apps/ui/src/Controls/TogglesPanel.tsx
import type { Modifiers } from "@/types";
import { Switch } from "@/components/Inputs";
import { eValue } from "@/utils/form";
import styles from "./TogglesPanel.module.css";

interface TogglesPanelProps {
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
}

const toggles: { key: keyof Modifiers; label: string }[] = [
  { key: "showDirections", label: "Network" },
  { key: "showVehicles", label: "Vehicles" },
  { key: "showHeatmap", label: "Heatmap" },
  { key: "showHeatzones", label: "Zones" },
  { key: "showPOIs", label: "POIs" },
];

export default function TogglesPanel({ modifiers, onChangeModifiers }: TogglesPanelProps) {
  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>Visibility</h2>
      </div>
      <div className={styles.body}>
        {toggles.map(({ key, label }) => (
          <label key={key} className={styles.row}>
            <span className={styles.label}>{label}</span>
            <Switch
              checked={modifiers[key]}
              onChange={eValue(onChangeModifiers(key))}
              aria-label={label}
            />
          </label>
        ))}
      </div>
    </>
  );
}
```

**Step 2: Create TogglesPanel CSS**

```css
/* apps/ui/src/Controls/TogglesPanel.module.css */
.header {
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-overlay-1);
  flex-shrink: 0;
}

.title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.body {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 150ms ease;
}

.row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.label {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}
```

**Step 3: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/TogglesPanel.tsx apps/ui/src/Controls/TogglesPanel.module.css
git commit -m "feat(ui): add TogglesPanel component"
```

---

### Task 4: Create SpeedPanel

**Files:**
- Create: `apps/ui/src/Controls/SpeedPanel.tsx`
- Create: `apps/ui/src/Controls/SpeedPanel.module.css`

**Step 1: Create SpeedPanel component**

This panel uses `useOptions` to read/write simulation speed params. Uses the existing `Range` input component.

```tsx
// apps/ui/src/Controls/SpeedPanel.tsx
import type { StartOptions } from "@/types";
import { Range } from "@/components/Inputs";
import { useOptions } from "@/hooks/useOptions";
import styles from "./SpeedPanel.module.css";

const sliders: {
  key: keyof StartOptions;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}[] = [
  { key: "maxSpeed", label: "Speed", min: 10, max: 120, unit: "km/h" },
  { key: "acceleration", label: "Acceleration", min: 1, max: 10 },
  { key: "deceleration", label: "Deceleration", min: 1, max: 10 },
  { key: "updateInterval", label: "Update Interval", min: 50, max: 2000, step: 50, unit: "ms" },
];

interface SpeedPanelProps {
  maxSpeedRef: React.MutableRefObject<number>;
}

export default function SpeedPanel({ maxSpeedRef }: SpeedPanelProps) {
  const { options, updateOption } = useOptions(300);
  maxSpeedRef.current = options.maxSpeed;

  const handleChange = (field: keyof StartOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    updateOption(field, Number(e.target.value) as StartOptions[typeof field]);
  };

  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>Speed</h2>
      </div>
      <div className={styles.body}>
        {sliders.map(({ key, label, min, max, step }) => (
          <Range
            key={key}
            label={label}
            value={options[key]}
            min={min}
            max={max}
            step={step}
            onChange={handleChange(key)}
          />
        ))}
      </div>
    </>
  );
}
```

**Step 2: Create SpeedPanel CSS**

```css
/* apps/ui/src/Controls/SpeedPanel.module.css */
.header {
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-overlay-1);
  flex-shrink: 0;
}

.title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.body {
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
```

**Step 3: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/SpeedPanel.tsx apps/ui/src/Controls/SpeedPanel.module.css
git commit -m "feat(ui): add SpeedPanel component"
```

---

### Task 5: Add Icon SVGs for Toggles and Speed

**Files:**
- Modify: `apps/ui/src/components/Icons.tsx`

**Step 1: Add EyeIcon and GaugeIcon**

Add these two new icon components at the end of the file (before the closing, after `RecordCircleIcon`):

```tsx
export function EyeIcon(props: SVGProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  );
}

export function GaugeIcon(props: SVGProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.54-12.95l-1.41 1.41L12 10.59l-2.13-2.13-1.41 1.41L10.59 12l-2.13 2.13 1.41 1.41L12 13.41l2.13 2.13 1.41-1.41L13.41 12l2.13-2.13z" />
    </svg>
  );
}
```

Actually, a better gauge/speedometer icon:

```tsx
export function GaugeIcon(props: SVGProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
      <path d="M12 6v2m-4.24.76l1.42 1.42M6 12h2m.76 4.24l1.42-1.42M12 16v2m4.24-.76l-1.42-1.42M18 12h-2m-.76-4.24l-1.42 1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M12 12l3-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
```

**Step 2: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/ui/src/components/Icons.tsx
git commit -m "feat(ui): add EyeIcon and GaugeIcon SVGs"
```

---

### Task 6: Expand IconRail to 7 entries

**Files:**
- Modify: `apps/ui/src/Controls/IconRail.tsx`
- Modify: `apps/ui/src/Controls/IconRail.module.css`

**Step 1: Update PanelId type and items array**

In `IconRail.tsx`, update the type and items:

```tsx
// Change the PanelId type
export type PanelId = "vehicles" | "fleets" | "incidents" | "recordings" | "toggles" | "speed" | "adapter";
```

Update the imports to add new icons:
```tsx
import { CarIcon, LayersIcon, AlertIcon, RecordCircleIcon, EyeIcon, GaugeIcon, Gear } from "@/components/Icons";
```

Replace the `items` array with two arrays:

```tsx
const topItems: { id: PanelId; Icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
  { id: "fleets", Icon: LayersIcon, label: "Fleets" },
  { id: "incidents", Icon: AlertIcon, label: "Incidents" },
  { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
  { id: "toggles", Icon: EyeIcon, label: "Visibility" },
  { id: "speed", Icon: GaugeIcon, label: "Speed" },
];

const bottomItems: typeof topItems = [
  { id: "adapter", Icon: Gear, label: "Adapter" },
];
```

Update the JSX to render both groups with a spacer:

```tsx
export default function IconRail({ activePanel, onPanelChange, incidentCount }: IconRailProps) {
  const renderButton = ({ id, Icon, label }: (typeof topItems)[number]) => (
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
  );

  return (
    <nav className={styles.rail} aria-label="Sidebar navigation">
      {topItems.map(renderButton)}
      <div className={styles.spacer} />
      {bottomItems.map(renderButton)}
    </nav>
  );
}
```

**Step 2: Add spacer style to IconRail.module.css**

Add at the end of the CSS file:

```css
.spacer {
  flex: 1;
}
```

**Step 3: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/ui/src/Controls/IconRail.tsx apps/ui/src/Controls/IconRail.module.css
git commit -m "feat(ui): expand IconRail to 7 entries with spacer"
```

---

### Task 7: Wire Everything into App.tsx

This is the main integration task. Remove ControlPanel, remove right panel, add BottomDock and new panels.

**Files:**
- Modify: `apps/ui/src/App.tsx`
- Modify: `apps/ui/src/App.module.css`

**Step 1: Update imports in App.tsx**

Remove:
```tsx
import ControlPanel from "./Controls/Controls";
```

Add:
```tsx
import BottomDock from "./Controls/BottomDock";
import TogglesPanel from "./Controls/TogglesPanel";
import SpeedPanel from "./Controls/SpeedPanel";
```

**Step 2: Remove `isAdapterPanelOpen` state**

Delete this line:
```tsx
const [isAdapterPanelOpen, setAdapterPanelOpen] = useState(false);
```

Update adapter hook — change `useAdapterConfig(isAdapterPanelOpen)` to `useAdapterConfig(activePanel === "adapter")`:
```tsx
const adapter = useAdapterConfig(activePanel === "adapter");
```

**Step 3: Remove the entire `.controls` div**

Delete lines 359-374 (the `<div className={styles.controls}>` block containing `<ControlPanel ... />`).

**Step 4: Remove the entire right panel aside**

Delete lines 497-516 (the `<aside className={...rightPanel...}>` block containing `<AdapterDrawer>`).

**Step 5: Add new panels inside the left panel's `.panelInner`**

After the recordings panel block (`{activePanel === "recordings" && ...}`), add:

```tsx
{activePanel === "toggles" && (
  <TogglesPanel
    modifiers={modifiers}
    onChangeModifiers={onChangeModifiers}
  />
)}
{activePanel === "speed" && (
  <SpeedPanel maxSpeedRef={maxSpeedRef} />
)}
{activePanel === "adapter" && (
  <AdapterDrawer
    isOpen={true}
    health={adapter.health}
    config={adapter.config}
    loading={adapter.loading}
    error={adapter.error}
    onClose={() => setActivePanel(null)}
    onSetSource={adapter.setSource}
    onAddSink={adapter.addSink}
    onRemoveSink={adapter.removeSink}
  />
)}
```

**Step 6: Add BottomDock inside the `.map` div**

After the `<FleetLegend>` component, add:

```tsx
<BottomDock
  status={status}
  connected={connected}
  vehicleCount={vehicles.length}
  replayStatus={replay.replayStatus}
  onPauseReplay={replay.pauseReplay}
  onResumeReplay={replay.resumeReplay}
  onStopReplay={replay.stopReplay}
  onSeekReplay={replay.seekReplay}
  onStartReplay={replay.startReplay}
/>
```

**Step 7: Remove ControlPanel-related props from the ControlPanel import**

Remove unused adapter panel toggle props that were only used by ControlPanel. The `onToggleVehiclePanel` and `onToggleAdapterPanel` callbacks are no longer needed.

**Step 8: Update App.module.css**

Remove the `.controls` class (lines 9-11):
```css
.controls {
  flex: 0;
}
```

Remove the `.rightPanel` and `.rightPanelOpen` classes (lines 68-80) and the `.rightPanel .panelInner` rule (lines 86-88).

**Step 9: Remove replay props from MapView**

In the `<MapView>` JSX, remove these props since ReplayBar is no longer inside Map:
```
replayStatus={replay.replayStatus}
onPauseReplay={replay.pauseReplay}
onResumeReplay={replay.resumeReplay}
onStopReplay={replay.stopReplay}
onSeekReplay={replay.seekReplay}
onStartReplay={replay.startReplay}
```

**Step 10: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds

**Step 11: Commit**

```bash
git add apps/ui/src/App.tsx apps/ui/src/App.module.css
git commit -m "feat(ui): wire BottomDock, TogglesPanel, SpeedPanel into App"
```

---

### Task 8: Remove ReplayBar from Map and Clean Up

**Files:**
- Modify: `apps/ui/src/Map/Map.tsx` — remove ReplayBar import and rendering, remove replay-related props
- Delete: `apps/ui/src/Map/ReplayBar.tsx`
- Delete: `apps/ui/src/Map/ReplayBar.module.css`

**Step 1: Clean Map.tsx**

Remove from imports:
```tsx
import ReplayBar from "./ReplayBar";
```

Remove from `MapProps` interface:
```tsx
replayStatus?: ReplayStatus;
onPauseReplay?: () => Promise<void>;
onResumeReplay?: () => Promise<void>;
onStopReplay?: () => Promise<void>;
onSeekReplay?: (timestamp: number) => Promise<void>;
onStartReplay?: (file: string, speed?: number) => Promise<void>;
```

Remove `ReplayStatus` from the type import.

Remove the destructured replay props from the function signature.

Remove the entire ReplayBar JSX block (lines 127-141).

**Step 2: Delete old files**

```bash
rm apps/ui/src/Map/ReplayBar.tsx apps/ui/src/Map/ReplayBar.module.css
```

**Step 3: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ui): remove ReplayBar from Map, clean up replay props"
```

---

### Task 9: Remove Old ControlPanel

**Files:**
- Delete: `apps/ui/src/Controls/Controls.tsx`
- Delete: `apps/ui/src/Controls/Controls.module.css`
- Modify: `apps/ui/src/Controls/useTracking.ts` — check if still used, keep if used by BottomDock or elsewhere

**Step 1: Check if useTracking is needed**

`useTracking` was called in `Controls.tsx` as `useTracking(vehicles, filters.selected, status.interval)`. Check what it does. If it performs side effects needed for the app (e.g., updating vehicle positions on the map), it needs to be called somewhere else (e.g., App.tsx). If it's only for the control panel UI, delete it.

Run: `cd apps/ui && grep -r "useTracking" src/ --include="*.ts" --include="*.tsx"`

If only referenced from Controls.tsx, check its implementation:
- If it does viewport tracking for the selected vehicle (auto-pan map), move the call to App.tsx
- If not needed, delete it

**Step 2: Delete Controls.tsx and Controls.module.css**

```bash
rm apps/ui/src/Controls/Controls.tsx apps/ui/src/Controls/Controls.module.css
```

**Step 3: Handle useTracking**

If useTracking is needed, add to App.tsx after the hooks section:

```tsx
import useTracking from "./Controls/useTracking";
// ... in the component body:
useTracking(vehicles, filters.selected, status.interval);
```

**Step 4: Verify it builds**

Run: `cd apps/ui && yarn build`
Expected: Build succeeds with no errors or warnings about removed files

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): remove old ControlPanel component"
```

---

### Task 10: Visual Polish and Testing

**Files:**
- Possibly adjust: `apps/ui/src/Controls/BottomDock.module.css`
- Possibly adjust: `apps/ui/src/Controls/IconRail.module.css`

**Step 1: Manual visual testing**

Run `cd apps/ui && yarn dev` and test:

1. **Live mode:**
   - Bottom dock shows play/pause, reset, zones, status chips, vehicle count
   - Play/pause toggles simulation
   - Reset works
   - Status chips reflect WS/SIM state

2. **Replay mode:**
   - Start a recording, stop it, click to replay
   - Bottom dock switches to replay controls
   - Progress bar is seekable
   - Speed buttons work (1x/2x/4x)
   - Stop returns to live mode dock

3. **Icon rail panels:**
   - All 7 icons visible, adapter at bottom
   - Toggles panel: switches toggle map layers
   - Speed panel: sliders control simulation speed
   - Adapter panel: opens from left (not right)
   - Existing panels (vehicles, fleets, incidents, recordings) work as before

4. **Edge cases:**
   - No top bar visible
   - No right panel slide-in
   - Dispatch mode still works with vehicles panel
   - Disconnect banner still shows

**Step 2: Fix any visual issues found**

Adjust CSS as needed (spacing, sizing, border radius, etc.).

**Step 3: Final build check**

Run: `cd apps/ui && yarn build`
Expected: Clean build, no warnings

**Step 4: Commit**

```bash
git add -A
git commit -m "fix(ui): polish dock and rail visual styling"
```
