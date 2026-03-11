# Fleet Grouping Design

**Goal:** Allow vehicles to be grouped into named fleets with distinct colors for visual differentiation on the UI map.

## Data Model

### Types (`types/index.ts`)

- `Vehicle.fleetId?: string` — optional fleet assignment on internal model
- `VehicleDTO.fleetId?: string` — included in serialized output when assigned
- `Fleet` — `{ id, name, color, vehicleIds }` interface
- `FleetDTO` — serialization format (vehicleIds as `string[]`)

### FleetManager Module

Standalone `EventEmitter` module (`modules/FleetManager.ts`) with:

- **Storage:** `Map<string, FleetState>` for fleets, `Map<string, string>` for vehicle-to-fleet reverse lookup
- **Color palette:** 10-color palette (`constants.ts: FLEET_COLORS`), auto-assigned on create, wraps cyclically
- **ID generation:** Sequential `fleet-1`, `fleet-2`, etc. Resets on simulation reset.
- **CRUD:** `create(name)`, `delete(fleetId)`, `assign(fleetId, vehicleId)`, `unassign(vehicleId)`, `getAll()`, `get(fleetId)`
- **Events:** `fleet:created`, `fleet:deleted`, `fleet:assigned`

### Integration

- `VehicleManager.fleets` — public FleetManager instance
- `VehicleManager.assignVehicleToFleet(vehicleId, fleetId)` — assigns and emits vehicle update
- `VehicleManager.unassignVehicleFromFleet(vehicleId)` — unassigns and emits vehicle update
- `VehicleManager.reset()` — also resets fleets
- `serializeVehicle()` — includes `fleetId` when present

## REST API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/fleets` | — | `FleetDTO[]` |
| POST | `/fleets` | `{ name }` | `FleetDTO` (201) |
| DELETE | `/fleets/:id` | — | `{ status: "deleted" }` |
| POST | `/fleets/assign` | `{ fleetId, vehicleId }` | `{ status: "assigned" }` |
| POST | `/fleets/unassign` | `{ vehicleId }` | `{ status: "unassigned" }` |

## WebSocket Events

| Event Type | Payload | Trigger |
|------------|---------|---------|
| `fleet:created` | `FleetDTO` | Fleet created |
| `fleet:deleted` | `{ id }` | Fleet deleted |
| `fleet:assigned` | `{ fleetId, vehicleId }` | Vehicle assigned/unassigned |
| `vehicle` | `VehicleDTO` (with `fleetId`) | Vehicle update includes fleet |

## Color Palette

10 colors allocated round-robin:
`#ef4444` (red), `#f97316` (orange), `#eab308` (yellow), `#22c55e` (green), `#14b8a6` (teal), `#3b82f6` (blue), `#6366f1` (indigo), `#a855f7` (purple), `#ec4899` (pink), `#78716c` (stone)
