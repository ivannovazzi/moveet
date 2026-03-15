# Changelog

## [0.0.4](https://github.com/ivannovazzi/moveet/compare/v0.0.3...v0.0.4) (2026-03-15)


### Features

* add fleet grouping with color-coded map display ([1afdc75](https://github.com/ivannovazzi/moveet/commit/1afdc75b39ab726d7fcfb9ee5a979ed7e80715c5))
* add FleetManager with REST + WebSocket fleet events ([ad9ee0f](https://github.com/ivannovazzi/moveet/commit/ad9ee0f4e972a10d7a7e1353a0d8a19ee7892aa1))
* dispatch ux redesign ([#8](https://github.com/ivannovazzi/moveet/issues/8)) ([c270710](https://github.com/ivannovazzi/moveet/commit/c270710f8690b672bf93e0f0972509bad9e8adbb))
* incidents/road events with dynamic A* rerouting ([#9](https://github.com/ivannovazzi/moveet/issues/9)) ([2404524](https://github.com/ivannovazzi/moveet/commit/2404524d7654bc0a58c1b627b1f308beee06b465))
* multi-stop waypoint routing with chained A* pathfinding ([#7](https://github.com/ivannovazzi/moveet/issues/7)) ([0f10659](https://github.com/ivannovazzi/moveet/commit/0f10659ee31ac8adc700b7665a61b5aecd071967))
* recording & replay for simulation sessions ([#10](https://github.com/ivannovazzi/moveet/issues/10)) ([667e9c0](https://github.com/ivannovazzi/moveet/commit/667e9c0899c7631935cd21a84805d79ea095a8fc))
* replay bottom bar, incident markers, and incident creation ([#12](https://github.com/ivannovazzi/moveet/issues/12)) ([096b94b](https://github.com/ivannovazzi/moveet/commit/096b94bccb09b81b42ac77bfd4a2b4353767cfae))
* **ui:** incidents panel and recording/replay controls ([#11](https://github.com/ivannovazzi/moveet/issues/11)) ([b7106e0](https://github.com/ivannovazzi/moveet/commit/b7106e0d93e041f82e68b8231169aa3f6dd877de))
* vehicle dispatch with batch UI and perf optimizations ([#6](https://github.com/ivannovazzi/moveet/issues/6)) ([040fd61](https://github.com/ivannovazzi/moveet/commit/040fd617c6e2c864f2f6a5d999918bf2872e4b85))


### Bug Fixes

* FleetManager API calls and vehicle spawning ([#4](https://github.com/ivannovazzi/moveet/issues/4)) ([4f2ff89](https://github.com/ivannovazzi/moveet/commit/4f2ff8909034938b23a8b1b4da17c1b9ce604a77))
* guard against missing vehicle name during replay ([d214cff](https://github.com/ivannovazzi/moveet/commit/d214cff9ca9f08f68fe5da638d4fc7bcd3179c52))
* perf/scale to thousant vehicles ([#5](https://github.com/ivannovazzi/moveet/issues/5)) ([8162173](https://github.com/ivannovazzi/moveet/commit/816217378cfcb095091b9e92ea74f50a7708d5aa))
* unwrap replay vehicle events for correct WS broadcast format ([bd7ec9c](https://github.com/ivannovazzi/moveet/commit/bd7ec9c9f188401dbe025b9a61f0de46954cc67c))
* update FleetManager tests to match implementation API ([ce0da76](https://github.com/ivannovazzi/moveet/commit/ce0da76a34e0e2b730b91054ab53d40d0aac3e5c))

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
