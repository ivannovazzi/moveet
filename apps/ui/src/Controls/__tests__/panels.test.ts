import { describe, expect, it } from "vitest";
import { BOTTOM_PANEL_IDS, PANEL_GROUPS, PANEL_IDS, PANELS } from "../panels";

describe("PANELS registry", () => {
  it("has an icon, label, and group for every panel id", () => {
    for (const id of PANEL_IDS) {
      const meta = PANELS[id];
      expect(meta, `missing registry entry for "${id}"`).toBeDefined();
      // Icons are React components — plain functions or forwardRef/memo wrappers.
      expect(["function", "object"]).toContain(typeof meta.icon);
      expect(meta.icon).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.group).toBeTruthy();
    }
  });

  it("rail groups plus the bottom section cover every panel id exactly once", () => {
    const covered = [...PANEL_GROUPS.flatMap((group) => group.ids), ...BOTTOM_PANEL_IDS];
    expect([...covered].sort()).toEqual([...PANEL_IDS].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("keeps the rail group order Fleet → Operations → Monitor", () => {
    expect(PANEL_GROUPS.map((group) => group.label)).toEqual(["Fleet", "Operations", "Monitor"]);
  });

  it("pins the adapter panel to the rail bottom", () => {
    expect(BOTTOM_PANEL_IDS).toEqual(["adapter"]);
  });
});
