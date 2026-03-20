import { SPATIAL_GRID } from "../constants";

/**
 * Spatial grid index for fast bbox queries over vehicle positions.
 *
 * Divides the coordinate space into a grid of cells (default ~500m).
 * Each vehicle is placed in exactly one cell based on its lat/lng.
 * Bbox queries collect vehicles from all cells that overlap the bbox,
 * reducing filtering from O(vehicles) to O(vehicles-in-bbox-cells).
 */
export class SpatialVehicleIndex {
  /** Grid cell size in degrees. */
  private readonly cellSize: number;

  /** Maps grid cell key "row,col" to the set of vehicle IDs in that cell. */
  private readonly grid: Map<string, Set<string>> = new Map();

  /** Maps vehicle ID to its current cell key, for efficient move/remove. */
  private readonly vehicleCell: Map<string, string> = new Map();

  constructor(cellSize?: number) {
    this.cellSize = cellSize ?? SPATIAL_GRID.CELL_SIZE;
  }

  /**
   * Computes the grid cell key for a lat/lng coordinate.
   */
  private cellKey(lat: number, lng: number): string {
    const row = Math.floor(lat / this.cellSize);
    const col = Math.floor(lng / this.cellSize);
    return `${row},${col}`;
  }

  /**
   * Inserts or moves a vehicle in the grid.
   * If the vehicle is already in the correct cell, this is a no-op.
   */
  update(vehicleId: string, lat: number, lng: number): void {
    const newKey = this.cellKey(lat, lng);
    const currentKey = this.vehicleCell.get(vehicleId);

    if (currentKey === newKey) return; // already in correct cell

    // Remove from old cell
    if (currentKey !== undefined) {
      const oldCell = this.grid.get(currentKey);
      if (oldCell) {
        oldCell.delete(vehicleId);
        if (oldCell.size === 0) {
          this.grid.delete(currentKey);
        }
      }
    }

    // Insert into new cell
    let cell = this.grid.get(newKey);
    if (!cell) {
      cell = new Set();
      this.grid.set(newKey, cell);
    }
    cell.add(vehicleId);
    this.vehicleCell.set(vehicleId, newKey);
  }

  /**
   * Removes a vehicle from the grid entirely.
   */
  remove(vehicleId: string): void {
    const key = this.vehicleCell.get(vehicleId);
    if (key === undefined) return;

    const cell = this.grid.get(key);
    if (cell) {
      cell.delete(vehicleId);
      if (cell.size === 0) {
        this.grid.delete(key);
      }
    }
    this.vehicleCell.delete(vehicleId);
  }

  /**
   * Returns all vehicle IDs whose grid cell overlaps the given bounding box.
   *
   * Note: This is a coarse filter — vehicles in cells that partially overlap
   * the bbox may be outside it. The caller should still do an exact point-in-bbox
   * check for precision. The spatial index eliminates the vast majority of
   * non-matching vehicles cheaply.
   */
  queryBbox(bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Set<string> {
    const result = new Set<string>();

    const minRow = Math.floor(bbox.minLat / this.cellSize);
    const maxRow = Math.floor(bbox.maxLat / this.cellSize);
    const minCol = Math.floor(bbox.minLng / this.cellSize);
    const maxCol = Math.floor(bbox.maxLng / this.cellSize);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = this.grid.get(`${row},${col}`);
        if (cell) {
          for (const id of cell) {
            result.add(id);
          }
        }
      }
    }

    return result;
  }

  /**
   * Returns the number of vehicles tracked in the index.
   */
  get size(): number {
    return this.vehicleCell.size;
  }

  /**
   * Returns the number of non-empty grid cells.
   */
  get cellCount(): number {
    return this.grid.size;
  }

  /**
   * Removes all vehicles from the index.
   */
  clear(): void {
    this.grid.clear();
    this.vehicleCell.clear();
  }
}
