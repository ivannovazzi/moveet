# Changelog

## [0.0.7](https://github.com/ivannovazzi/moveet/compare/v0.0.6...v0.0.7) (2026-03-24)


### Features

* **network:** preserve POIs, traffic signals, turn restrictions & multilingual search ([#90](https://github.com/ivannovazzi/moveet/issues/90)) ([eed417b](https://github.com/ivannovazzi/moveet/commit/eed417b501afcf53a20ac8373716f94cda7ecfe4))
* Scenario Engine — scripted simulation events ([#84](https://github.com/ivannovazzi/moveet/issues/84)) ([2438e92](https://github.com/ivannovazzi/moveet/commit/2438e923a55a58a9d204d5bfa2f1103cecd72c7e))
* **simulator:** openapi spec with scalar API reference (fleetsim-all-xbc) ([#82](https://github.com/ivannovazzi/moveet/issues/82)) ([0c72834](https://github.com/ivannovazzi/moveet/commit/0c72834bc04249ea3dd921a9356ec18d57f10c4c))
* ui loading transitions, fetch retry, adapter CORS & vehicle type propagation ([#95](https://github.com/ivannovazzi/moveet/issues/95)) ([4331f4e](https://github.com/ivannovazzi/moveet/commit/4331f4eb20aeaa38838a14134b833666faaa2c34))
* ws subscribe filters & state persistence (fleetsim-all-p21o) ([#89](https://github.com/ivannovazzi/moveet/issues/89)) ([bab74d6](https://github.com/ivannovazzi/moveet/commit/bab74d6e7eee23acedbe750fb9f086c728e9ad4f))
* **ws:** centralize subscribe filter with vehicle type + debounce (fleetsim-all-hpo.4) ([#83](https://github.com/ivannovazzi/moveet/issues/83)) ([7dad83c](https://github.com/ivannovazzi/moveet/commit/7dad83c03ddab1109f88a289d93986748977b5f3))
* **ws:** subscribe filter — UI sends subscribe on fleet toggle (fleetsim-all-hpo.4) ([#79](https://github.com/ivannovazzi/moveet/issues/79)) ([15ca67f](https://github.com/ivannovazzi/moveet/commit/15ca67f7059177ebe2eecd4c9870376cfaad93f0))


### Bug Fixes

* codebase quality audit — 26 issues across all apps ([#94](https://github.com/ivannovazzi/moveet/issues/94)) ([4840958](https://github.com/ivannovazzi/moveet/commit/484095876d633e03b414e44b2fe3eccb505e90b7))
* geofence events, trail visibility, fleet assignment + event naming ([#87](https://github.com/ivannovazzi/moveet/issues/87)) ([ab2d37d](https://github.com/ivannovazzi/moveet/commit/ab2d37d461e0d9f3643c44fb9021b81189500744))
* **simulator:** use weighted vehicle type distribution in default mode ([#93](https://github.com/ivannovazzi/moveet/issues/93)) ([3c5f178](https://github.com/ivannovazzi/moveet/commit/3c5f17835bf64e6693df08fdbcad6a4487a48685))
* **ui:** add --legacy-peer-deps to Docker build ([#91](https://github.com/ivannovazzi/moveet/issues/91)) ([79213cc](https://github.com/ivannovazzi/moveet/commit/79213ccceae053a5a911a5bc4c4b6bcdb9ea6976))
* **ui:** comprehensive UI/UX audit — 16 issues across reliability, consistency, and accessibility ([#88](https://github.com/ivannovazzi/moveet/issues/88)) ([b298e69](https://github.com/ivannovazzi/moveet/commit/b298e691cc9f7a1a8a864db3441edceb72838227))
* **ui:** resolve geofence draw offset, add confirm button, move draw zone control to panel ([#78](https://github.com/ivannovazzi/moveet/issues/78)) ([74ae7c3](https://github.com/ivannovazzi/moveet/commit/74ae7c384d120225d4f9bfcf063519a993a97078))
* vehicle trails, adapter timeouts, and missing tests ([#96](https://github.com/ivannovazzi/moveet/issues/96)) ([fa5449f](https://github.com/ivannovazzi/moveet/commit/fa5449f192a9b46bb15495f43311f7dfdf32d26d))


### Performance Improvements

* **network:** Deck.gl, improved network ([#92](https://github.com/ivannovazzi/moveet/issues/92)) ([d2b31e3](https://github.com/ivannovazzi/moveet/commit/d2b31e370fc945d9df9fd16b9f2ee35ad0964cd0))
* optimize pathfinding hot paths in simulator ([#109](https://github.com/ivannovazzi/moveet/issues/109)) ([10e2b10](https://github.com/ivannovazzi/moveet/commit/10e2b10839785164d01f4a99524b7ca34ac0458c))

## [0.0.6](https://github.com/ivannovazzi/moveet/compare/v0.0.5...v0.0.6) (2026-03-19)


### Bug Fixes

* **docker:** mount network GeoJSON at runtime ([#75](https://github.com/ivannovazzi/moveet/issues/75)) ([67faeeb](https://github.com/ivannovazzi/moveet/commit/67faeeb422965f2fd84bbd6119a3c036c32ced56))

## [0.0.5](https://github.com/ivannovazzi/moveet/compare/v0.0.4...v0.0.5) (2026-03-19)


### Features

* add lint-staged to pre-commit hook for auto-formatting and linting ([#72](https://github.com/ivannovazzi/moveet/issues/72)) ([a368bf7](https://github.com/ivannovazzi/moveet/commit/a368bf7c1792d095bde38d000476be60c3efa70c))
* apps/network — OSM road network CLI pipeline ([#64](https://github.com/ivannovazzi/moveet/issues/64)) ([54f62bd](https://github.com/ivannovazzi/moveet/commit/54f62bd9118292f2dd3f58e1e6b59a6ae463c948))
* geofencing system with zone drawing and alerts (fleetsim-all-8xl) ([#63](https://github.com/ivannovazzi/moveet/issues/63)) ([800fbe3](https://github.com/ivannovazzi/moveet/commit/800fbe3b992d41488263cf8ee2ebd9eafc09d38e))
* **network:** prune disconnected components, fix city-agnostic spawning ([#73](https://github.com/ivannovazzi/moveet/issues/73)) ([0b1844d](https://github.com/ivannovazzi/moveet/commit/0b1844de09c2d0e1078dd1efdc17bd69535df7b3))
* phase 1 stability & quality improvements ([#57](https://github.com/ivannovazzi/moveet/issues/57)) ([a4ae737](https://github.com/ivannovazzi/moveet/commit/a4ae73703a27e8f0f0357e87448c73d7c807fcb8))
* **sim:** simulation realism — BPR congestion, smoothness, traffic signals, incident cache ([#69](https://github.com/ivannovazzi/moveet/issues/69)) ([7b35cad](https://github.com/ivannovazzi/moveet/commit/7b35cadfa397ade48efc5acdfe494ed1d4dbcfb9))
* time-of-day traffic patterns (fleetsim-all-pv8) ([#16](https://github.com/ivannovazzi/moveet/issues/16)) ([6073126](https://github.com/ivannovazzi/moveet/commit/60731269c64489711f589a2c1250c771dd720f2e))
* **ui:** migrate interactive components to react-aria-components ([#62](https://github.com/ivannovazzi/moveet/issues/62)) ([0aa0d07](https://github.com/ivannovazzi/moveet/commit/0aa0d0740140d8a8af985fc9a945d547aa80b7ba))
* vehicle breadcrumb trails on map ([#61](https://github.com/ivannovazzi/moveet/issues/61)) ([479046b](https://github.com/ivannovazzi/moveet/commit/479046b803b7b1c7c671de015508351025be12b5))
* vehicle types with differentiated behavior ([#18](https://github.com/ivannovazzi/moveet/issues/18)) ([6c5e6b0](https://github.com/ivannovazzi/moveet/commit/6c5e6b0699c8e75dea672eff82a542636b4847a5))
* **ws:** WebSocket subscribe filters for targeted vehicle updates ([#71](https://github.com/ivannovazzi/moveet/issues/71)) ([33887ca](https://github.com/ivannovazzi/moveet/commit/33887ca84769eaeb6651b9d80523d951b1d71f01))


### Bug Fixes

* **network:** call runCLI() so CLI actually starts ([#65](https://github.com/ivannovazzi/moveet/issues/65)) ([373209c](https://github.com/ivannovazzi/moveet/commit/373209ce1e3f677dc688936522c5e640ca2f4674))
* **network:** make the network download pipeline fully working ([#70](https://github.com/ivannovazzi/moveet/issues/70)) ([062743b](https://github.com/ivannovazzi/moveet/commit/062743ba5f47f50cb88df2050e7f2ebe92afaa9d))
* **network:** road topology bugs — epsilon dedup, oneway=-1, roundabouts, road classes ([#67](https://github.com/ivannovazzi/moveet/issues/67)) ([d1c1e58](https://github.com/ivannovazzi/moveet/commit/d1c1e5877045e8d46cfee192f11c9236a80b3736))
* **routing:** P1 routing quality — turn restrictions, heuristic, access filter, roundabouts ([#68](https://github.com/ivannovazzi/moveet/issues/68)) ([3461860](https://github.com/ivannovazzi/moveet/commit/346186029e7f654d7f2ddef5255af624cdfb0cac))
* **ui:** resolve geofence draw offset, add confirm button, move draw zone control to panel ([#74](https://github.com/ivannovazzi/moveet/issues/74)) ([48c6ccd](https://github.com/ivannovazzi/moveet/commit/48c6ccdcf91d78799ef51628b1bc0af4ecb72380))

## [0.0.4](https://github.com/ivannovazzi/moveet/compare/v0.0.3...v0.0.4) (2026-03-16)


### Features

* add fleet grouping with color-coded map display ([1afdc75](https://github.com/ivannovazzi/moveet/commit/1afdc75b39ab726d7fcfb9ee5a979ed7e80715c5))
* add FleetManager with REST + WebSocket fleet events ([ad9ee0f](https://github.com/ivannovazzi/moveet/commit/ad9ee0f4e972a10d7a7e1353a0d8a19ee7892aa1))
* dispatch ux redesign ([#8](https://github.com/ivannovazzi/moveet/issues/8)) ([c270710](https://github.com/ivannovazzi/moveet/commit/c270710f8690b672bf93e0f0972509bad9e8adbb))
* incidents/road events with dynamic A* rerouting ([#9](https://github.com/ivannovazzi/moveet/issues/9)) ([2404524](https://github.com/ivannovazzi/moveet/commit/2404524d7654bc0a58c1b627b1f308beee06b465))
* multi-stop waypoint routing with chained A* pathfinding ([#7](https://github.com/ivannovazzi/moveet/issues/7)) ([0f10659](https://github.com/ivannovazzi/moveet/commit/0f10659ee31ac8adc700b7665a61b5aecd071967))
* recording & replay for simulation sessions ([#10](https://github.com/ivannovazzi/moveet/issues/10)) ([667e9c0](https://github.com/ivannovazzi/moveet/commit/667e9c0899c7631935cd21a84805d79ea095a8fc))
* replay bottom bar, incident markers, and incident creation ([#12](https://github.com/ivannovazzi/moveet/issues/12)) ([096b94b](https://github.com/ivannovazzi/moveet/commit/096b94bccb09b81b42ac77bfd4a2b4353767cfae))
* **ui:** icon rail with multi-panel sidebar ([#13](https://github.com/ivannovazzi/moveet/issues/13)) ([2e28ea9](https://github.com/ivannovazzi/moveet/commit/2e28ea9e22dc9aaf4fc65d9c952c29f9973ea005))
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
