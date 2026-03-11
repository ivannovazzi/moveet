# Fleet Grouping with Color-Coded Map Display

Date: 2026-03-11

## Summary

Group vehicles into fleets with auto-assigned colors. Fleets are managed via the UI (create, delete, assign vehicles) and can also come from external sources through the adapter. Fleet colors appear on map markers.

## Data Model

```typescript
interface Fleet {
  id: string;           // uuid
  name: string;
  color: string;        // hex, auto-assigned from palette
  source: 'local' | 'external';
  vehicleIds: string[];
}
```

VehicleDTO gains `fleetId?: string` (null = unassigned, renders gray).

Color palette (10 maximally-separated hues, assigned round-robin):
```
#e6194b #3cb44b #4363d8 #f58231 #911eb4
#42d4f4 #f032e6 #bfef45 #fabed4 #dcbeff
```

## API (Simulator)

```
GET    /fleets              → Fleet[]
POST   /fleets              → Fleet        { name: string }
DELETE /fleets/:id          → void
POST   /fleets/:id/assign   → void        { vehicleIds: string[] }
POST   /fleets/:id/unassign → void        { vehicleIds: string[] }
```

Color auto-assigned on creation. Assigning a vehicle to a fleet removes it from any previous fleet. External fleets (`source: 'external'`) are read-only.

## WebSocket Events (Simulator → UI)

```
{ type: "fleet:created",  data: Fleet }
{ type: "fleet:deleted",  data: { id: string } }
{ type: "fleet:assigned", data: { fleetId: string, vehicleIds: string[] } }
```

Vehicle updates continue as-is; the UI resolves fleet color from the vehicle's `fleetId`.

## Adapter

- Source plugin interface gains optional `getFleets(): Fleet[]`
- On sync, external fleets pushed to simulator via `POST /fleets` with `source: 'external'`
- External fleet vehicle assignments come through the same sync
- Static source plugin gets fleet support as reference implementation

## Merge Behavior

External fleets are read-only in the UI. Users can create local fleets alongside them. External definitions win on ID conflicts.

## UI Components

### Fleets Panel (Controls sidebar, above Vehicles list)
- Fleet rows: color dot, name, vehicle count. Lock icon for external fleets.
- Click to expand and see member vehicles.
- "New Fleet" button: inline text input, enter to create. Hidden when all 10 palette slots used.
- Delete (trash icon) per local fleet. Unassigns all vehicles. Not shown for external fleets.

### Vehicle Fleet Assignment
- Each vehicle row gets a colored dot (fleet color) or gray if unassigned.
- Click vehicle → dropdown of available fleets + "Unassigned". Disabled for external-source vehicles.

### Map Markers
- Polygon fill changes to fleet color (inline style). Gray if unassigned.
- Stroke, hover, and selection states unchanged (layer on top).

### Fleet Legend (map bottom-right overlay)
- Color dot + name per active fleet.
- Click to toggle fleet visibility on the map.

### New Hook: useFleets()
- Fetches fleet list via GET /fleets on mount.
- Subscribes to WebSocket fleet events.
- Exposes CRUD actions: createFleet, deleteFleet, assignVehicles, unassignVehicles.

## Data Flow

```
External Source → Adapter → POST /fleets (source: external)
                            ↓
User UI action  →  ───────→ Simulator (fleet CRUD + assignment)
                            ↓ WebSocket
                            UI (markers colored by fleet)
```

## Out of Scope

- Persistent fleet storage (ephemeral in simulator memory)
- Fleet-level dispatch actions
- Fleet analytics or statistics
- Color picker / custom colors
