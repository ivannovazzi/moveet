# Changelog

## 3.0.0 (2026-03-10)

### Breaking Changes

* Renamed project from FleetSim to **Moveet**
* Package scopes changed from `@fleetsim/*` to `@moveet/*`

### Features

* Redesigned control panel — narrow top bar, vehicle sidebar, simplified options
* Vehicle reset functionality and enhanced WebSocket communication
* Road network intelligence — edge metadata from GeoJSON (road type, speed limits, one-way, lanes)

### Chores

* Restructured as Turborepo monorepo under `apps/` directory
* Added GitHub Actions CI pipeline (lint, test, build)
* Added SECURITY.md and CODE_OF_CONDUCT.md
* Cleaned up adapter README — removed internal references, fixed placeholder URLs

## 2.0.0 (2025-03-08)

### Features

* Consolidated fleetsim, fleetsim-adapter, and fleetsim-ui into a Turborepo monorepo
* Shared TypeScript configuration via tsconfig.base.json
* Unified development commands via Turborepo (dev, build, lint, test)
