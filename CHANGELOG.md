# Changelog

## [0.0.3](https://github.com/ivannovazzi/moveet/compare/v0.0.2...v0.0.3) (2026-03-10)


### Bug Fixes

* build multi-platform Docker images (amd64 + arm64) ([1011b76](https://github.com/ivannovazzi/moveet/commit/1011b769caef7ffa1f9453a83b9eb5c1723e3735))
* consolidate release and docker publish into single workflow ([0e9ac9b](https://github.com/ivannovazzi/moveet/commit/0e9ac9b220efba60570401479cbf529664753c7c))
* inline tsconfig base into each app for standalone Docker builds ([4611d67](https://github.com/ivannovazzi/moveet/commit/4611d67b38c3e72178d5fad066a8e1eca509e79d))
* use npm install in Dockerfiles for monorepo compatibility ([7582b7f](https://github.com/ivannovazzi/moveet/commit/7582b7f222ef3c5ceb093cc91d93ccb77edec2c6))

## [0.0.2](https://github.com/ivannovazzi/moveet/compare/moveet-v0.0.1...moveet-v0.0.2) (2026-03-10)


### Bug Fixes

* build multi-platform Docker images (amd64 + arm64) ([1011b76](https://github.com/ivannovazzi/moveet/commit/1011b769caef7ffa1f9453a83b9eb5c1723e3735))
* inline tsconfig base into each app for standalone Docker builds ([4611d67](https://github.com/ivannovazzi/moveet/commit/4611d67b38c3e72178d5fad066a8e1eca509e79d))
* use npm install in Dockerfiles for monorepo compatibility ([7582b7f](https://github.com/ivannovazzi/moveet/commit/7582b7f222ef3c5ceb093cc91d93ccb77edec2c6))

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
