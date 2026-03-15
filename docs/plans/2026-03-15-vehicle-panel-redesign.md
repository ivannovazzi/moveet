# Vehicle Panel Redesign — Icon Rail + Multi-Panel

**Date**: 2026-03-15
**Status**: Approved

## Problem

The left sidebar crams too many controls into a single panel: vehicles, fleets, incidents, and recording/replay. It has become confusing and overwhelming.

## Solution

Replace the monolith sidebar with an **icon rail** (narrow vertical strip) + **swappable panel** pattern. One panel visible at a time. Clicking the active panel's icon collapses the sidebar entirely for full map view.

## Icon Rail

- 48px wide, pinned to left edge, always visible
- 4 icon buttons, top-aligned
- States: default (muted gray), active (blue left accent bar + highlighted icon), hover (subtle background)
- Single state: `activePanel: 'vehicles' | 'fleets' | 'incidents' | 'recordings' | null`

## Panel Structure

~300px wide, slides in/out to the right of the rail. Consistent layout:

- **Sticky header**: title + primary action button
- **Scrollable body**: panel content
- **Sticky footer** (optional): only Vehicles panel uses this for dispatch

## Panels

### Vehicles

- Header: "Vehicles" + badge count + search filter
- Body: vehicle cards (name, speed, speed bar, route distance)
- Fleet dropdown removed from vehicle cards (moved to Fleets panel)
- "Fleet overview" eyebrow removed
- Dispatch mode unchanged: checkboxes, waypoint/result badges, dispatch footer all stay here

### Fleets

- Header: "Fleets" + "+ New" button
- Body: fleet list (color dot, name, vehicle count, delete)
- Clicking a fleet expands to show member vehicles with assign/remove actions
- New fleet input appears inline

### Incidents

- Header: "Incidents" + Auto toggle + "+" button
- Body: incident list (type, severity bar, countdown timer, remove)
- Content unchanged, just in its own panel

### Recordings

- Header: "Recordings"
- Body: record button + elapsed timer, then scrollable recording list (file size, date)
- Content unchanged, just in its own panel

## Key Simplifications

1. Each panel has a single responsibility
2. Vehicle cards lose the fleet dropdown (biggest declutter win)
3. Map space maximized — only one panel open, or none
4. Well-understood UX pattern (VS Code, Figma)
