import { describe, it, expect } from "vitest";
import type { FeatureCollection } from "geojson";
import {
  buildRestrictionFilterArgs,
  buildRestrictionOplArgs,
  parseRestrictionsOpl,
  appendRestrictions,
} from "./restrictions.js";

// OPL as `osmium cat -f opl` prints it for a restrictions-only extract.
const OPL = [
  "n42437881 v7 dV c0 t2015-01-05T14:29:24Z i0 u T x-73.9795827 y40.7845691",
  "n2140997998 v1 dV c0 t2015-01-05T14:29:24Z i0 u Thighway=traffic_signals x-73.93 y40.85",
  "w788602261 v3 dV c0 t2020-01-01T00:00:00Z i0 u Thighway=primary Nn1,n42437881",
  // Simple via-node restriction with an except tag.
  "r1077654 v7 dV c0 t2021-11-16T20:18:13Z i0 u Texcept=bus,restriction=no_left_turn,type=restriction Mw788602261@from,w5671620@to,n42437881@via",
  // Member order differs; OPL-escaped conditional value (space %20%, @ %40%).
  "r2739524 v1 dV c0 t2013-02-04T05:42:58Z i0 u Trestriction:conditional=no_left_turn%20%%40%%20%(Mo-Fr),restriction=only_straight_on,type=restriction Mn2140997998@via,w32973209@from,w204083742@to",
  // Via-way restriction: unsupported, skipped.
  "r3 v1 dV c0 t2013-02-04T05:42:58Z i0 u Trestriction=no_u_turn,type=restriction Mw1@from,w2@via,w3@to",
  // Via node not present in the extract: skipped.
  "r4 v1 dV c0 t2013-02-04T05:42:58Z i0 u Trestriction=no_right_turn,type=restriction Mw1@from,n999@via,w3@to",
  // Two from ways (no_entry style): skipped.
  "r5 v1 dV c0 t2013-02-04T05:42:58Z i0 u Trestriction=no_entry,type=restriction Mw1@from,w6@from,n42437881@via,w3@to",
  "",
].join("\n");

describe("buildRestrictionFilterArgs", () => {
  it("keeps only restriction relations (plus the objects they reference)", () => {
    const args = buildRestrictionFilterArgs({
      input: "/cache/nyc-roads.osm.pbf",
      output: "/cache/nyc-roads-restrictions.osm.pbf",
    });
    expect(args).toEqual([
      "tags-filter",
      "nyc-roads.osm.pbf",
      "r/type=restriction",
      "-o",
      "nyc-roads-restrictions.osm.pbf",
      "--overwrite",
    ]);
    // Referenced objects are needed for the via-node coordinates.
    expect(args).not.toContain("-R");
  });
});

describe("buildRestrictionOplArgs", () => {
  it("prints the extract as OPL on stdout", () => {
    expect(buildRestrictionOplArgs("/cache/x-restrictions.osm.pbf")).toEqual([
      "cat",
      "x-restrictions.osm.pbf",
      "-f",
      "opl",
    ]);
  });
});

describe("parseRestrictionsOpl", () => {
  const result = parseRestrictionsOpl(OPL);

  it("emits a Point at the via node with from/to way ids and all relation tags", () => {
    expect(result.features).toHaveLength(2);
    const [first, second] = result.features;
    expect(first.geometry).toEqual({ type: "Point", coordinates: [-73.9795827, 40.7845691] });
    expect(first.properties).toEqual({
      "@id": 1077654,
      type: "restriction",
      restriction: "no_left_turn",
      except: "bus",
      from: 788602261,
      to: 5671620,
    });
    expect(second.geometry).toEqual({ type: "Point", coordinates: [-73.93, 40.85] });
    expect(second.properties).toMatchObject({
      restriction: "only_straight_on",
      "restriction:conditional": "no_left_turn @ (Mo-Fr)",
      from: 32973209,
      to: 204083742,
    });
  });

  it("counts what it had to skip", () => {
    expect(result.skipped).toEqual({ viaWay: 1, missingViaNode: 1, ambiguous: 1 });
  });

  it("tolerates empty input", () => {
    expect(parseRestrictionsOpl("")).toEqual({
      features: [],
      skipped: { viaWay: 0, missingViaNode: 0, ambiguous: 0 },
    });
  });
});

describe("appendRestrictions", () => {
  it("appends restriction features after the exported roads without touching them", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { "@id": 1, highway: "primary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      ],
    };
    const { features } = parseRestrictionsOpl(OPL);
    const out = appendRestrictions(fc, features);
    expect(out.features).toHaveLength(3);
    expect(out.features[0]).toBe(fc.features[0]);
    expect(out.features[1].properties?.type).toBe("restriction");
  });
});
