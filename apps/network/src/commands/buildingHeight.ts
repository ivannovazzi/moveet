/**
 * Resolve an extrusion height (metres) for an OSM building.
 *
 * OSM height tagging is sparse: in the Nairobi extract only about 0.2% of
 * buildings carry `height` and 0.7% `building:levels`. The order is therefore:
 *
 *   1. `height` (metres, or feet when suffixed `ft` / `'`)
 *   2. `building:levels` x {@link LEVEL_HEIGHT_M}
 *   3. a default for the `building` type ({@link TYPE_DEFAULT_HEIGHT_M}),
 *      else {@link DEFAULT_HEIGHT_M}
 *
 * Values outside a sane range are treated as missing rather than trusted, so a
 * typo like `height=3000` falls through to the next rule instead of drawing a
 * needle over the city.
 */

export const LEVEL_HEIGHT_M = 3;
export const DEFAULT_HEIGHT_M = 7;
/** Tallest value accepted from a tag; anything above is treated as a typo. */
export const MAX_HEIGHT_M = 500;
const MAX_LEVELS = 150;
const FEET_TO_M = 0.3048;

/** Per-type defaults for untagged buildings, around one to four storeys. */
export const TYPE_DEFAULT_HEIGHT_M: Readonly<Record<string, number>> = {
  // Small single-storey structures.
  garage: 3,
  garages: 3,
  shed: 3,
  hut: 3,
  kiosk: 3,
  carport: 3,
  roof: 3,
  toilets: 3,
  service: 3,
  // Unfinished: a slab or a frame, not a block.
  construction: 3,
  foundation: 1,
  // Houses.
  house: 6,
  detached: 6,
  semidetached_house: 6,
  bungalow: 4,
  terrace: 6,
  residential: 7,
  // Larger footprints that are usually taller.
  apartments: 12,
  dormitory: 12,
  hotel: 15,
  office: 15,
  commercial: 10,
  retail: 8,
  industrial: 8,
  warehouse: 8,
  school: 8,
  hospital: 12,
  church: 10,
  mosque: 10,
};

function parseNumber(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Parse an OSM `height` value to metres, or null when absent or implausible. */
export function parseHeight(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  const n = parseNumber(value);
  if (n === null) return null;
  const metres = /(ft|feet|')\s*$/.test(value) ? n * FEET_TO_M : n;
  return metres > 0 && metres <= MAX_HEIGHT_M ? metres : null;
}

/** Parse an OSM `building:levels` value, or null when absent or implausible. */
export function parseLevels(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = parseNumber(raw.trim());
  return n !== null && n > 0 && n <= MAX_LEVELS ? n : null;
}

export type BuildingTags = Readonly<Record<string, unknown>>;

function tag(tags: BuildingTags, key: string): string | undefined {
  const value = tags[key];
  return typeof value === "string" ? value : undefined;
}

/** Extrusion height in metres for a building's tags. Always positive. */
export function resolveHeight(tags: BuildingTags): number {
  const height = parseHeight(tag(tags, "height"));
  if (height !== null) return height;
  const levels = parseLevels(tag(tags, "building:levels"));
  if (levels !== null) return levels * LEVEL_HEIGHT_M;
  const type = tag(tags, "building");
  return (type && TYPE_DEFAULT_HEIGHT_M[type]) || DEFAULT_HEIGHT_M;
}
