import { describe, it, expect } from "vitest";
import { GROUP_META, POI_GROUPS, groupForType, type PoiGroup } from "./categories";

/**
 * The expected mapping is restated here rather than imported, so a typo in the
 * lookup table is a test failure instead of two matching typos.
 */
const EXPECTED: Record<PoiGroup, string[]> = {
  transit: [
    "bus_stop",
    "bus_station",
    "taxi",
    "parking",
    "parking_entrance",
    "parking_space",
    "motorcycle_parking",
    "bicycle_parking",
    "car_rental",
    "motorcycle_rental",
    "charging_station",
    "vehicle_inspection",
    "weighbridge",
  ],
  shop: [
    "shop",
    "craft",
    "marketplace",
    "atm",
    "bank",
    "bureau_de_change",
    "mobile_money_agent",
    "money_transfer",
    "payment_terminal",
    "post_office",
    "vending_machine",
    "butchery",
    "Cereals",
    "grinding_mill",
    "hairdresser",
    "car_wash",
    "parcel_locker",
  ],
  food: [
    "restaurant",
    "cafe",
    "fast_food",
    "food_court",
    "pub",
    "bar",
    "nightclub",
    "ice_cream",
    "bbq",
    "internet_cafe",
    "cyber_cafe",
  ],
  health: [
    "hospital",
    "clinic",
    "doctors",
    "dentist",
    "pharmacy",
    "healthcare",
    "laboratory",
    "veterinary",
    "nursing_home",
    "mortuary",
    "clinic;pharmacy;laboratory",
    "traditional health centre",
    "medical transport service",
    "social_facility",
    "group_home",
    "animal_shelter",
  ],
  education: [
    "school",
    "School",
    "college",
    "university",
    "kindergarten",
    "prep_school",
    "driving_school",
    "library",
    "training",
    "research_institute",
    "childcare",
    "school for pwds",
    "school;place_of_worship",
  ],
  civic: [
    "police",
    "courthouse",
    "townhall",
    "public_building",
    "public_building;parking",
    "fire_station",
    "prison",
    "community_centre",
    "community_centre;drinking_water",
    "social_centre",
    "polling_station",
    "ranger_station",
    "post_box",
    "office",
    "coworking_space",
    "conference_centre",
    "events_venue",
    "exhibition_centre",
    "arts_centre",
    "Resource Center",
    "ujamaa family centre",
    "Youth Group",
    "reception_desk",
  ],
  worship: ["place_of_worship", "church", "monastery"],
  leisure: [
    "leisure",
    "cinema",
    "community_cinema",
    "theatre",
    "casino",
    "gambling",
    "studio",
    "club",
    "boat_rental",
    "fountain",
  ],
  fuel: ["fuel"],
};

/** Types present in the data that the map deliberately never draws. */
const HIDDEN = [
  "toilets",
  "drinking_water",
  "water_point",
  "waste_basket",
  "waste_disposal",
  "waste_transfer_station",
  "waste_dump_site",
  "landfill",
  "recycling",
  "compost_site",
  "shelter",
  "bench",
  "shower",
  "telephone",
  "clock",
  "transformer",
  "surveillance",
  "smoking_area",
  "dressing_room",
  "luggage_locker",
  "baby_hatch",
  "bicycle_repair_station",
  "fixme",
  "*",
  "building",
  "residential",
];

describe("groupForType", () => {
  for (const group of POI_GROUPS) {
    it.each(EXPECTED[group])(`maps %s to ${group}`, (type) => {
      expect(groupForType(type)).toBe(group);
    });
  }

  it.each(HIDDEN)("hides %s", (type) => {
    expect(groupForType(type)).toBeNull();
  });

  it("hides unknown and missing types", () => {
    expect(groupForType("zzz")).toBeNull();
    expect(groupForType(undefined)).toBeNull();
    expect(groupForType("")).toBeNull();
  });

  it("falls back to a case-insensitive match", () => {
    expect(groupForType("HOSPITAL")).toBe("health");
    expect(groupForType("Bus_Stop")).toBe("transit");
  });
});

describe("GROUP_META", () => {
  it("describes every group", () => {
    for (const group of POI_GROUPS) {
      const meta = GROUP_META[group];
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.token).toBe(`var(--color-poi-${group})`);
    }
    expect(Object.keys(GROUP_META).sort()).toEqual([...POI_GROUPS].sort());
  });

  it("gates every group inside the street-zoom band", () => {
    for (const group of POI_GROUPS) {
      expect(GROUP_META[group].minZoom).toBeGreaterThanOrEqual(12);
      expect(GROUP_META[group].minZoom).toBeLessThanOrEqual(15);
    }
  });

  it("gives every group a distinct collision priority", () => {
    const priorities = POI_GROUPS.map((g) => GROUP_META[g].priority);
    expect(new Set(priorities).size).toBe(POI_GROUPS.length);
  });
});
