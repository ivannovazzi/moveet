# UI Theme Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify all interactive element sizing, colors, and spacing across the UI using a consistent token system.

**Architecture:** Add new semantic tokens to tokens.css, then update all CSS modules to reference them. Pure CSS refactoring — no component logic changes.

**Tech Stack:** CSS custom properties, CSS Modules

---

### Task 1: Expand tokens.css

Add new tokens for the unified scale:

```css
/* Interactive element heights — unified scale */
--control-sm: 28px;    /* chips, badges, compact */
--control: 32px;        /* standard buttons, inputs */
--control-lg: 40px;     /* dock buttons, rail buttons, primary actions */
--control-xl: 56px;     /* dock/searchbar containers */

/* Icon sizes */
--icon-sm: 14px;
--icon: 16px;
--icon-lg: 18px;

/* Glass surfaces */
--glass-bg: rgba(7, 9, 13, 0.88);
--glass-border: 1px solid var(--color-overlay-1);
--glass-blur: blur(16px);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);

/* Status colors — backgrounds at 0.12 opacity */
--color-success-bg: rgba(68, 204, 68, 0.12);
--color-success-bg-hover: rgba(68, 204, 68, 0.2);
--color-success: #4c4;

--color-danger-bg: rgba(244, 67, 54, 0.12);
--color-danger-bg-hover: rgba(244, 67, 54, 0.18);
--color-danger: #f44;

--color-active-bg: rgba(57, 153, 255, 0.14);
--color-active-border: rgba(57, 153, 255, 0.22);

/* Focus states */
--focus-border: rgba(57, 153, 255, 0.5);
--focus-ring: 0 0 0 2px rgba(57, 153, 255, 0.1);
--focus-bg: rgba(57, 153, 255, 0.06);
```

Remove old tokens: `--control-height-sm`, `--control-height`, `--control-height-lg`

### Task 2: Update BottomDock.module.css

- Dock height: 48→56px (`var(--control-xl)`)
- Dock buttons: 34→40px (`var(--control-lg)`)
- Dock icons: 15→18px (`var(--icon-lg)`)
- Stop button: 34→40px (`var(--control-lg)`)
- Record button: 34→40px, icon 14→16px
- Speed buttons: 34→40px (`var(--control-lg)`)
- Progress wrap: 34→40px
- Chips height: 28→28px (`var(--control-sm)`)
- Dock bg → `var(--glass-bg)`
- Active states → `var(--color-success-bg)`, `var(--color-danger-bg)`, `var(--color-active-bg)`
- Dock padding: space-5→space-6
- Dock gap: space-4→space-5
- Dock border-radius: 14px→`var(--radius-xl)` (12px, close enough)
- Divider height: 22→28px

### Task 3: Update IconRail.module.css

- Rail width: 48→56px
- Rail buttons: 36→40px (`var(--control-lg)`)
- Rail icon: 18px (`var(--icon-lg)`) — already correct
- Rail bg → `var(--glass-bg)` at 0.74 opacity → keep as-is (lighter)

### Task 4: Update panel headers for consistency

All panel headers (Vehicles, Fleets, Incidents, RecordReplay, TogglesPanel, SpeedPanel):
- Padding: `var(--space-5) var(--space-5) var(--space-4)`
- Title font: `var(--text-lg)` (15px), weight 600
- Body padding: `var(--space-4) var(--space-5)`

### Task 5: Update SearchBar.module.css

- Height: 48px → `var(--control-xl)` (56px)
- Font size: `calc(var(--text-base) + 1px)` → `var(--text-md)` (14px)
- Padding: `0 18px` → `0 var(--space-6)` (16px)
- Focus border → `var(--focus-border)`
- Background → `var(--glass-bg)`

### Task 6: Update Inputs.module.css

- `.button` height: `var(--control-height)` → `var(--control)`
- `.squaredButton` height/width: `var(--control-height)` → `var(--control)`
- `.input` height: `var(--control-height-sm)` → `var(--control-sm)`
- Focus states: hard-coded → `var(--focus-border)`, `var(--focus-ring)`, `var(--focus-bg)`
- `.squaredButtonIcon`: 16px → `var(--icon)`

### Task 7: Update remaining files

- **Zoom.module.css**: `var(--control-height-lg)` → `var(--control-lg)`
- **DispatchFooter**: buttons → explicit `height: var(--control-sm)`
- **Vehicles.module.css**: filterInput 44px → `var(--control-lg)` (40px), focus → tokens
- **App.module.css**: leftPanel left: 48→56px (match rail width)

### Task 8: Build check + visual test
