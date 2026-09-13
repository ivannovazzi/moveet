/**
 * POI semantic groups.
 *
 * The simulator serves ~21,000 POIs spread over ~130 raw OSM `amenity` values,
 * most of which are noise on an operations map (a waste basket, a bench, a
 * `fixme` tag). Rendering one marker style per raw type is both impossible and
 * pointless, so every type is folded into one of nine groups an operator
 * actually reasons about — or into `null`, which means "do not draw this".
 *
 * Each group carries its own zoom gate and collision priority, so the map
 * reveals POIs in order of operational usefulness: hospitals and fuel first,
 * the shop/food/leisure carpet only once you are inside a neighbourhood.
 */

export type PoiGroup =
  | "transit"
  | "shop"
  | "food"
  | "health"
  | "education"
  | "civic"
  | "worship"
  | "leisure"
  | "fuel";

export const POI_GROUPS: readonly PoiGroup[] = [
  "transit",
  "shop",
  "food",
  "health",
  "education",
  "civic",
  "worship",
  "leisure",
  "fuel",
] as const;

/**
 * Raw OSM type → group. Anything absent is deliberately unrendered: street
 * furniture, waste infrastructure, tagging artefacts, and types too generic to
 * mean anything on a fleet map (`building`, `residential`, `*`).
 */
const TYPE_TO_GROUP: Record<string, PoiGroup> = {
  // ── transit ──────────────────────────────────────────────────────
  bus_stop: "transit",
  bus_station: "transit",
  taxi: "transit",
  parking: "transit",
  parking_entrance: "transit",
  parking_space: "transit",
  motorcycle_parking: "transit",
  bicycle_parking: "transit",
  car_rental: "transit",
  motorcycle_rental: "transit",
  charging_station: "transit",
  vehicle_inspection: "transit",
  weighbridge: "transit",

  // ── shop & services ──────────────────────────────────────────────
  shop: "shop",
  craft: "shop",
  marketplace: "shop",
  atm: "shop",
  bank: "shop",
  bureau_de_change: "shop",
  mobile_money_agent: "shop",
  money_transfer: "shop",
  payment_terminal: "shop",
  post_office: "shop",
  vending_machine: "shop",
  butchery: "shop",
  Cereals: "shop",
  grinding_mill: "shop",
  hairdresser: "shop",
  car_wash: "shop",
  parcel_locker: "shop",

  // ── food & drink ─────────────────────────────────────────────────
  restaurant: "food",
  cafe: "food",
  fast_food: "food",
  food_court: "food",
  pub: "food",
  bar: "food",
  nightclub: "food",
  ice_cream: "food",
  bbq: "food",
  internet_cafe: "food",
  cyber_cafe: "food",

  // ── health ───────────────────────────────────────────────────────
  hospital: "health",
  clinic: "health",
  doctors: "health",
  dentist: "health",
  pharmacy: "health",
  healthcare: "health",
  laboratory: "health",
  veterinary: "health",
  nursing_home: "health",
  mortuary: "health",
  "clinic;pharmacy;laboratory": "health",
  "traditional health centre": "health",
  "medical transport service": "health",
  social_facility: "health",
  group_home: "health",
  animal_shelter: "health",

  // ── education ────────────────────────────────────────────────────
  school: "education",
  School: "education",
  college: "education",
  university: "education",
  kindergarten: "education",
  prep_school: "education",
  driving_school: "education",
  library: "education",
  training: "education",
  research_institute: "education",
  childcare: "education",
  "school for pwds": "education",
  "school;place_of_worship": "education",

  // ── civic ────────────────────────────────────────────────────────
  police: "civic",
  courthouse: "civic",
  townhall: "civic",
  public_building: "civic",
  "public_building;parking": "civic",
  fire_station: "civic",
  prison: "civic",
  community_centre: "civic",
  "community_centre;drinking_water": "civic",
  social_centre: "civic",
  polling_station: "civic",
  ranger_station: "civic",
  post_box: "civic",
  office: "civic",
  coworking_space: "civic",
  conference_centre: "civic",
  events_venue: "civic",
  exhibition_centre: "civic",
  arts_centre: "civic",
  "Resource Center": "civic",
  "ujamaa family centre": "civic",
  "Youth Group": "civic",
  reception_desk: "civic",

  // ── worship ──────────────────────────────────────────────────────
  place_of_worship: "worship",
  church: "worship",
  monastery: "worship",

  // ── leisure ──────────────────────────────────────────────────────
  leisure: "leisure",
  cinema: "leisure",
  community_cinema: "leisure",
  theatre: "leisure",
  casino: "leisure",
  gambling: "leisure",
  studio: "leisure",
  club: "leisure",
  boat_rental: "leisure",
  fountain: "leisure",

  // ── fuel ─────────────────────────────────────────────────────────
  fuel: "fuel",
};

/**
 * The group a raw OSM type belongs to, or `null` when it should not be drawn.
 *
 * Matched case-sensitively first (the data carries both `school` and `School`,
 * and `Cereals` has no lowercase sibling), then case-insensitively so a stray
 * capitalisation still lands in the right group instead of vanishing.
 */
export function groupForType(type: string | undefined): PoiGroup | null {
  if (!type) return null;
  return TYPE_TO_GROUP[type] ?? TYPE_TO_GROUP[type.toLowerCase()] ?? null;
}

/**
 * Whether the map will draw this POI at all: it needs a name to label and a
 * group to style. The raw feed is ~130 OSM types, most of them street
 * furniture, so the same test gates the markers, the search results and the
 * command palette — offering a result that selects an invisible marker is
 * worse than not offering it.
 */
interface MappableCandidate {
  name?: string | null;
  type?: string;
}

export function mappableGroup(poi: MappableCandidate): PoiGroup | null {
  return poi.name ? groupForType(poi.type) : null;
}

/**
 * The same test as a predicate, for callers that don't need the group. It
 * narrows `name`, which those callers go on to search and render.
 */
export function isMappablePoi<T extends MappableCandidate>(poi: T): poi is T & { name: string } {
  return mappableGroup(poi) !== null;
}

/**
 * Marker diameter in pixels. Wayfinding anchors — hospitals, fuel, transit —
 * are drawn full size; the ambient carpet (shops, food, leisure, civic,
 * education, worship) is a size smaller so it reads as background even where it
 * survives the collision pass. Shared by the GPU `IconLayer` and the HTML
 * marker in `POI.tsx`, which used to size transit at 16px and disagree with it.
 */
export const ANCHOR_MARKER_PX = 22;
export const DEFAULT_MARKER_PX = 18;

export const ANCHOR_GROUPS: ReadonlySet<PoiGroup> = new Set<PoiGroup>([
  "health",
  "transit",
  "fuel",
]);

export function markerSizeForGroup(group: PoiGroup): number {
  return ANCHOR_GROUPS.has(group) ? ANCHOR_MARKER_PX : DEFAULT_MARKER_PX;
}

/**
 * Per-group presentation.
 *
 * `minZoom` is the zoom at which the group fades in: health and fuel are
 * wayfinding anchors worth seeing from across the city, while the shop/food/
 * leisure carpet only earns its pixels at street level. `priority` breaks
 * collisions between overlapping markers — higher wins.
 *
 * The gates are deliberately late. Nairobi carries ~21,000 POIs, so a
 * 1600x1000 view at zoom 14-15 used to hold several hundred markers at once
 * and read as noise; pushing the carpet groups past 14 keeps street zoom to
 * the handful of anchors an operator is actually navigating by.
 */
export const GROUP_META: Record<
  PoiGroup,
  { label: string; token: string; minZoom: number; priority: number }
> = {
  transit: { label: "Transit", token: "var(--color-poi-transit)", minZoom: 13, priority: 8 },
  shop: { label: "Shops & services", token: "var(--color-poi-shop)", minZoom: 14.5, priority: 3 },
  food: { label: "Food & drink", token: "var(--color-poi-food)", minZoom: 14.5, priority: 2 },
  health: { label: "Health", token: "var(--color-poi-health)", minZoom: 12.5, priority: 9 },
  education: {
    label: "Education",
    token: "var(--color-poi-education)",
    minZoom: 14,
    priority: 5,
  },
  civic: { label: "Civic", token: "var(--color-poi-civic)", minZoom: 13.5, priority: 6 },
  worship: { label: "Worship", token: "var(--color-poi-worship)", minZoom: 14, priority: 4 },
  leisure: { label: "Leisure", token: "var(--color-poi-leisure)", minZoom: 14.5, priority: 1 },
  fuel: { label: "Fuel", token: "var(--color-poi-fuel)", minZoom: 12.5, priority: 7 },
};
