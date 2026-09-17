import { describe, it, expect } from "vitest";
import {
  turnAngle,
  turnPenaltySeconds,
  turnCostHours,
  isUTurnAllowed,
  parseTurnRestriction,
  resolveTurnBans,
  type TurnGraphEdge,
  type TurnNodeContext,
} from "../../modules/pathfinding/turns";

// ─── Turn geometry + penalties (fleetsim-all-1ajn.3) ─────────────────

const intersection: TurnNodeContext = { degree: 4, signalized: false };
const signalized: TurnNodeContext = { degree: 4, signalized: true };
const bend: TurnNodeContext = { degree: 2, signalized: false };

describe("turnAngle", () => {
  it("is 0 for straight on, positive for right (clockwise), negative for left", () => {
    expect(turnAngle(0, 0)).toBe(0);
    expect(turnAngle(0, 90)).toBe(90);
    expect(turnAngle(0, 270)).toBe(-90);
    expect(turnAngle(350, 10)).toBe(20);
    expect(turnAngle(10, 350)).toBe(-20);
  });

  it("maps a reversal to 180", () => {
    expect(Math.abs(turnAngle(90, 270))).toBe(180);
  });
});

describe("turnPenaltySeconds", () => {
  it("charges nothing for straight on or a slight bend", () => {
    expect(turnPenaltySeconds(0, 0, false, true, intersection, "right")).toBe(0);
    expect(turnPenaltySeconds(0, 25, false, true, intersection, "right")).toBe(0);
    expect(turnPenaltySeconds(0, 335, false, true, intersection, "right")).toBe(0);
  });

  it("charges a left turn across oncoming traffic more than a right turn in right-hand traffic", () => {
    const right = turnPenaltySeconds(0, 90, false, true, intersection, "right");
    const left = turnPenaltySeconds(0, 270, false, true, intersection, "right");
    expect(right).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(right);
  });

  it("mirrors the far-side penalty in left-hand traffic", () => {
    const rhtLeft = turnPenaltySeconds(0, 270, false, true, intersection, "right");
    const rhtRight = turnPenaltySeconds(0, 90, false, true, intersection, "right");
    expect(turnPenaltySeconds(0, 90, false, true, intersection, "left")).toBe(rhtLeft);
    expect(turnPenaltySeconds(0, 270, false, true, intersection, "left")).toBe(rhtRight);
  });

  it("charges sharper turns more than gentler ones on the same side", () => {
    const gentle = turnPenaltySeconds(0, 60, false, true, intersection, "right");
    const sharp = turnPenaltySeconds(0, 140, false, true, intersection, "right");
    expect(sharp).toBeGreaterThan(gentle);
  });

  it("drops the oncoming-traffic extra when the approach is one-way (no oncoming traffic)", () => {
    const twoWay = turnPenaltySeconds(0, 270, false, true, intersection, "right");
    const oneWay = turnPenaltySeconds(0, 270, false, false, intersection, "right");
    const right = turnPenaltySeconds(0, 90, false, false, intersection, "right");
    expect(oneWay).toBeLessThan(twoWay);
    expect(oneWay).toBe(right);
  });

  it("reduces the oncoming-traffic extra at a signal (the phase handles the conflict)", () => {
    const unsignalized = turnPenaltySeconds(0, 270, false, true, intersection, "right");
    const withSignal = turnPenaltySeconds(0, 270, false, true, signalized, "right");
    const right = turnPenaltySeconds(0, 90, false, true, signalized, "right");
    expect(withSignal).toBeLessThan(unsignalized);
    expect(withSignal).toBeGreaterThan(right);
  });

  it("charges only the geometric part at a bend that is not an intersection", () => {
    const bendLeft = turnPenaltySeconds(0, 270, false, true, bend, "right");
    const bendRight = turnPenaltySeconds(0, 90, false, true, bend, "right");
    expect(bendLeft).toBe(bendRight);
    expect(bendLeft).toBeGreaterThan(0);
  });

  it("charges a U-turn the most, and keeps every penalty modest", () => {
    const uTurn = turnPenaltySeconds(0, 180, true, true, intersection, "right");
    for (const out of [30, 60, 90, 120, 150, 179, 181, 210, 240, 270, 300, 330]) {
      for (const twoWay of [true, false]) {
        for (const ctx of [intersection, signalized, bend]) {
          for (const side of ["left", "right"] as const) {
            const p = turnPenaltySeconds(0, out, false, twoWay, ctx, side);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(15);
            expect(uTurn).toBeGreaterThan(p);
          }
        }
      }
    }
    expect(uTurn).toBeLessThanOrEqual(40);
  });

  it("turnCostHours is turnPenaltySeconds in hours", () => {
    expect(turnCostHours(0, 270, false, true, intersection, "right")).toBeCloseTo(
      turnPenaltySeconds(0, 270, false, true, intersection, "right") / 3600,
      12
    );
  });
});

describe("isUTurnAllowed", () => {
  it("allows U-turns at dead ends and intersections, not mid-block", () => {
    expect(isUTurnAllowed(1)).toBe(true);
    expect(isUTurnAllowed(2)).toBe(false);
    expect(isUTurnAllowed(3)).toBe(true);
    expect(isUTurnAllowed(4)).toBe(true);
  });

  it("allows a mid-block U-turn when it is the node's only exit (no trap)", () => {
    // Two-way road to A plus an inbound-only one-way from C: degree 2, and the
    // only outgoing edge is the one back to A.
    expect(isUTurnAllowed(2, 1)).toBe(true);
    expect(isUTurnAllowed(2, 2)).toBe(false);
  });
});

// ─── Restriction parsing ─────────────────────────────────────────────

const snap = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;

describe("parseTurnRestriction", () => {
  const viaPoint = { type: "Point" as const, coordinates: [36.805, -1.285] };

  it("reads the network CLI shape: Point geometry at the via node, numeric way ids", () => {
    const r = parseTurnRestriction(
      { type: "restriction", restriction: "no_left_turn", from: 11, to: 22 },
      viaPoint,
      snap
    );
    expect(r).toEqual({ kind: "no", from: "11", to: "22", via: snap(-1.285, 36.805) });
  });

  it("reads the legacy shape: `via` as a lat,lon string without geometry", () => {
    const r = parseTurnRestriction(
      {
        type: "restriction",
        restriction: "only_straight_on",
        from: "a",
        via: "-1.285,36.805",
        to: "b",
      },
      null,
      snap
    );
    expect(r).toEqual({ kind: "only", from: "a", to: "b", via: snap(-1.285, 36.805) });
  });

  it("prefers restriction:motorcar over the generic value", () => {
    const r = parseTurnRestriction(
      {
        type: "restriction",
        restriction: "no_left_turn",
        "restriction:motorcar": "only_right_turn",
        from: 1,
        to: 2,
      },
      viaPoint,
      snap
    );
    expect(r?.kind).toBe("only");
  });

  it("ignores restrictions that only apply to other vehicle classes", () => {
    expect(
      parseTurnRestriction(
        { type: "restriction", "restriction:hgv": "no_left_turn", from: 1, to: 2 },
        viaPoint,
        snap
      )
    ).toBeNull();
  });

  it("ignores a generic restriction whose except= exempts cars", () => {
    expect(
      parseTurnRestriction(
        {
          type: "restriction",
          restriction: "no_left_turn",
          except: "bus;motorcar",
          from: 1,
          to: 2,
        },
        viaPoint,
        snap
      )
    ).toBeNull();
    // Exempting only buses still binds cars.
    expect(
      parseTurnRestriction(
        { type: "restriction", restriction: "no_left_turn", except: "bus", from: 1, to: 2 },
        viaPoint,
        snap
      )
    ).not.toBeNull();
  });

  it("ignores conditional-only, unknown-valued and incomplete relations", () => {
    expect(
      parseTurnRestriction(
        {
          type: "restriction",
          "restriction:conditional": "no_left_turn @ (Mo-Fr)",
          from: 1,
          to: 2,
        },
        viaPoint,
        snap
      )
    ).toBeNull();
    expect(
      parseTurnRestriction(
        { type: "restriction", restriction: "give_way", from: 1, to: 2 },
        viaPoint,
        snap
      )
    ).toBeNull();
    expect(
      parseTurnRestriction(
        { type: "restriction", restriction: "no_left_turn", from: 1 },
        viaPoint,
        snap
      )
    ).toBeNull();
    expect(
      parseTurnRestriction(
        { type: "restriction", restriction: "no_left_turn", from: 1, to: 2 },
        null,
        snap
      )
    ).toBeNull();
    expect(parseTurnRestriction({ highway: "primary" }, viaPoint, snap)).toBeNull();
  });
});

// ─── Resolving restrictions to (inEdge, outEdge) bans ─────────────────

describe("resolveTurnBans", () => {
  // Plus-shaped junction X with arms S(outh), N(orth), E(ast), W(est); every
  // arm is its own two-way way, so each has an edge into and out of X.
  const arms = ["S", "N", "E", "W"];
  const edges: TurnGraphEdge[] = arms.flatMap((arm) => [
    { id: `${arm}>X`, streetId: arm, startNodeId: arm, endNodeId: "X" },
    { id: `X>${arm}`, streetId: arm, startNodeId: "X", endNodeId: arm },
  ]);
  const incoming = (node: string) => edges.filter((e) => e.endNodeId === node);
  const outgoing = (node: string) => edges.filter((e) => e.startNodeId === node);

  it("bans exactly the from→to transition for a no_* restriction", () => {
    const bans = resolveTurnBans(
      [{ kind: "no", from: "S", via: "X", to: "W" }],
      incoming,
      outgoing
    );
    expect([...bans.keys()]).toEqual(["S>X"]);
    expect([...bans.get("S>X")!]).toEqual(["X>W"]);
  });

  it("bans every other exit for an only_* restriction", () => {
    const bans = resolveTurnBans(
      [{ kind: "only", from: "S", via: "X", to: "N" }],
      incoming,
      outgoing
    );
    expect([...bans.get("S>X")!].sort()).toEqual(["X>E", "X>S", "X>W"]);
  });

  it("limits a same-way no_u_turn to the reversal", () => {
    const bans = resolveTurnBans(
      [{ kind: "no", from: "S", via: "X", to: "S" }],
      incoming,
      outgoing
    );
    expect([...bans.get("S>X")!]).toEqual(["X>S"]);
  });

  it("does not narrow a same-way only_* restriction to the reversal", () => {
    // A way passing straight through X: only_straight_on from S onto the same
    // way must keep the straight continuation, not only the U-turn.
    const through: TurnGraphEdge[] = [
      { id: "S>X", streetId: "T", startNodeId: "S", endNodeId: "X" },
      { id: "X>S", streetId: "T", startNodeId: "X", endNodeId: "S" },
      { id: "X>N", streetId: "T", startNodeId: "X", endNodeId: "N" },
      { id: "X>E", streetId: "E", startNodeId: "X", endNodeId: "E" },
    ];
    const bans = resolveTurnBans(
      [{ kind: "only", from: "T", via: "X", to: "T" }],
      (n) => through.filter((e) => e.endNodeId === n),
      (n) => through.filter((e) => e.startNodeId === n)
    );
    expect([...bans.get("S>X")!]).toEqual(["X>E"]);
  });

  it("drops an only_* restriction whose to-way is not in the graph instead of stranding the approach", () => {
    const bans = resolveTurnBans(
      [{ kind: "only", from: "S", via: "X", to: "missing" }],
      incoming,
      outgoing
    );
    expect(bans.size).toBe(0);
  });

  it("unions the allowed exits of several only_* restrictions on the same approach", () => {
    const bans = resolveTurnBans(
      [
        { kind: "only", from: "S", via: "X", to: "N" },
        { kind: "only", from: "S", via: "X", to: "E" },
      ],
      incoming,
      outgoing
    );
    expect([...bans.get("S>X")!].sort()).toEqual(["X>S", "X>W"]);
  });

  it("ignores restrictions whose via node or from-way is not in the graph", () => {
    const bans = resolveTurnBans(
      [
        { kind: "no", from: "S", via: "nowhere", to: "W" },
        { kind: "no", from: "missing", via: "X", to: "W" },
      ],
      incoming,
      outgoing
    );
    expect(bans.size).toBe(0);
  });
});
