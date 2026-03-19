import { EventEmitter } from "events";
import crypto from "crypto";
import type { Incident, IncidentDTO, IncidentType } from "../types";

export class IncidentManager extends EventEmitter {
  private incidents: Map<string, Incident> = new Map();
  private edgeIndex: Map<string, Set<string>> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Creates a new incident affecting the given edges.
   *
   * @param edgeIds - Edge IDs affected by this incident
   * @param type - Type of incident: 'accident', 'closure', or 'construction'
   * @param duration - Duration in milliseconds
   * @param severity - Severity from 0 to 1 (default: 0.5)
   * @returns The created Incident object
   */
  createIncident(
    edgeIds: string[],
    type: IncidentType,
    duration: number,
    severity: number = 0.5,
    position?: [number, number]
  ): Incident {
    const speedFactor = this.computeSpeedFactor(type, severity);

    const incident: Incident = {
      id: crypto.randomUUID(),
      edgeIds,
      type,
      severity,
      speedFactor,
      startTime: Date.now(),
      duration,
      autoClears: true,
      position: position ?? [0, 0],
    };

    this.incidents.set(incident.id, incident);

    for (const edgeId of edgeIds) {
      let ids = this.edgeIndex.get(edgeId);
      if (!ids) {
        ids = new Set();
        this.edgeIndex.set(edgeId, ids);
      }
      ids.add(incident.id);
    }

    this.emit("incident:created", incident);
    return incident;
  }

  /**
   * Removes an incident by ID.
   *
   * @param id - The incident ID to remove
   * @returns true if the incident existed and was removed, false otherwise
   */
  removeIncident(id: string): boolean {
    const incident = this.incidents.get(id);
    if (!incident) return false;

    this.removeFromIndex(incident);
    this.incidents.delete(id);
    this.emit("incident:cleared", { id, reason: "manual" });
    return true;
  }

  /**
   * Returns all active incidents.
   */
  getActiveIncidents(): Incident[] {
    return Array.from(this.incidents.values());
  }

  /**
   * Returns all incidents affecting a specific edge.
   *
   * @param edgeId - The edge ID to look up
   * @returns Array of incidents on this edge
   */
  getEdgeIncidents(edgeId: string): Incident[] {
    const ids = this.edgeIndex.get(edgeId);
    if (!ids || ids.size === 0) return [];

    const result: Incident[] = [];
    for (const id of ids) {
      const incident = this.incidents.get(id);
      if (incident) result.push(incident);
    }
    return result;
  }

  /**
   * Returns the lowest speedFactor for an edge (worst incident wins).
   * Returns 1.0 if no incidents affect this edge.
   *
   * @param edgeId - The edge ID to check
   */
  getEdgeSpeedFactor(edgeId: string): number {
    const ids = this.edgeIndex.get(edgeId);
    if (!ids || ids.size === 0) return 1.0;

    let min = 1.0;
    for (const id of ids) {
      const incident = this.incidents.get(id);
      if (incident && incident.speedFactor < min) {
        min = incident.speedFactor;
      }
    }
    return min;
  }

  /**
   * Returns true if any incident on this edge has speedFactor === 0 (fully blocked).
   *
   * @param edgeId - The edge ID to check
   */
  isEdgeBlocked(edgeId: string): boolean {
    const ids = this.edgeIndex.get(edgeId);
    if (!ids || ids.size === 0) return false;

    for (const id of ids) {
      const incident = this.incidents.get(id);
      if (incident && incident.speedFactor === 0) return true;
    }
    return false;
  }

  /**
   * Removes all active incidents, emitting 'incident:cleared' for each.
   */
  clearAll(): void {
    for (const [id] of this.incidents) {
      this.emit("incident:cleared", { id, reason: "manual" });
    }
    this.incidents.clear();
    this.edgeIndex.clear();
  }

  /**
   * Starts the periodic cleanup interval that auto-clears expired incidents.
   *
   * @param intervalMs - Cleanup check interval in milliseconds (default: 5000)
   */
  startCleanup(intervalMs: number = 5000): void {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), intervalMs);
  }

  /**
   * Stops the periodic cleanup interval.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Converts an Incident to its DTO representation for API responses.
   *
   * @param incident - The incident to convert
   * @returns The IncidentDTO with computed expiresAt field
   */
  toDTO(incident: Incident): IncidentDTO {
    return {
      id: incident.id,
      edgeIds: incident.edgeIds,
      type: incident.type,
      severity: incident.severity,
      speedFactor: incident.speedFactor,
      startTime: incident.startTime,
      duration: incident.duration,
      expiresAt: incident.startTime + incident.duration,
      autoClears: incident.autoClears,
      position: incident.position,
    };
  }

  /**
   * Replaces all incident state from a previously-saved snapshot.
   * Used by PersistenceManager during restore.
   *
   * @param incidents - Array of IncidentDTO-like objects
   */
  restoreIncidents(incidents: Array<Record<string, unknown>>): void {
    this.incidents.clear();
    this.edgeIndex.clear();

    for (const raw of incidents) {
      const incident: Incident = {
        id: raw.id as string,
        edgeIds: raw.edgeIds as string[],
        type: raw.type as IncidentType,
        severity: raw.severity as number,
        speedFactor: raw.speedFactor as number,
        startTime: raw.startTime as number,
        duration: raw.duration as number,
        autoClears: raw.autoClears as boolean,
        position: raw.position as [number, number],
      };

      this.incidents.set(incident.id, incident);

      for (const edgeId of incident.edgeIds) {
        let ids = this.edgeIndex.get(edgeId);
        if (!ids) {
          ids = new Set();
          this.edgeIndex.set(edgeId, ids);
        }
        ids.add(incident.id);
      }
    }
  }

  /**
   * Computes the speed factor for a given incident type and severity.
   */
  private computeSpeedFactor(type: IncidentType, severity: number): number {
    switch (type) {
      case "closure":
        return 0;
      case "accident":
        return 0.1 + severity * 0.2;
      case "construction":
        return 0.3 + severity * 0.3;
    }
  }

  /**
   * Removes an incident from the edge index.
   */
  private removeFromIndex(incident: Incident): void {
    for (const edgeId of incident.edgeIds) {
      const ids = this.edgeIndex.get(edgeId);
      if (ids) {
        ids.delete(incident.id);
        if (ids.size === 0) {
          this.edgeIndex.delete(edgeId);
        }
      }
    }
  }

  /**
   * Cleans up expired incidents that have autoClears enabled.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, incident] of this.incidents) {
      if (incident.autoClears && now > incident.startTime + incident.duration) {
        this.removeFromIndex(incident);
        this.incidents.delete(id);
        this.emit("incident:cleared", { id, reason: "expired" });
      }
    }
  }
}
