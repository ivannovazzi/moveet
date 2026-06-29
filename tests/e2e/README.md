# docker-compose smoke E2E

A single thin black-box smoke test (`smoke.e2e.test.ts`) that boots the whole
Moveet stack with docker compose and exercises it through its public HTTP +
WebSocket surface only. It proves the published images boot, wire together, and
produce moving vehicles end to end.

What it does:

1. `docker compose up -d` (published GHCR images by default).
2. Waits for the simulator `/health` to report `ok`.
3. `POST /start` to begin a simulation.
4. Polls `GET /vehicles` until the fleet appears.
5. Opens a WebSocket, asserts at least one `vehicles` frame arrives, and that a
   vehicle's position changes over time (it actually moves).
6. Tears the stack down (always, in `afterAll`).

## Run it

From the repo root:

```bash
npm run test:e2e
```

Requirements:

- A reachable **Docker daemon** (the test skips cleanly with a warning if none).
- A road network at `apps/simulator/data/network.geojson` (gitignored; generate
  it with `npx tsx apps/network/src/cli.ts prepare nairobi`). The test skips
  cleanly if it is missing.

By default it runs the published images from `docker-compose.ghcr.yml` (no
build). To build the images from source instead (much slower):

```bash
MOVEET_E2E_COMPOSE_FILE=docker-compose.yml npm run test:e2e
```

Other overrides: `MOVEET_E2E_SIM_URL` (default `http://localhost:5010`),
`MOVEET_E2E_WS_URL` (default `ws://localhost:5010`).

## Why it is isolated

This test is deliberately kept OUT of the unit `verify` CI job and is not a
dependency of `npm test` — it is slow and needs Docker. It runs only via
`npm run test:e2e` and the dedicated, opt-in `e2e` CI job (see
`.github/workflows/ci.yml`).
