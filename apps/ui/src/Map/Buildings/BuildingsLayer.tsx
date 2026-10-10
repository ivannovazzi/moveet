import { useEffect, useMemo, useState } from "react";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useMapRevision } from "@/data/mapRevision";
import { resolveMapColor } from "@/lib/mapColor";
import {
  type Building,
  type BuildingsIndex,
  loadBuildingsIndex,
  loadTile,
  tilesInView,
} from "./buildingsData";

/**
 * Optional 3D buildings: OSM footprints extruded to their tagged (or default)
 * height, from the simulator's pre-cut z14 tiles.
 *
 * Mounted (and lazy-loaded) from `Map.tsx` only while the Buildings toggle is
 * on, so the off state costs nothing. Below {@link BUILDINGS_MIN_ZOOM} nothing
 * is fetched or drawn: a city's worth of footprints at that scale is noise and
 * hundreds of thousands of polygons. At street zoom only the tiles in view are
 * fetched, each its own `SolidPolygonLayer` so a tile is tessellated once and
 * kept while it stays on screen.
 *
 * Neutral and slightly translucent so it reads as context under the vehicles,
 * routes and overlays, which all draw on top (see LAYER_ORDER). Not pickable.
 */

export const BUILDINGS_MIN_ZOOM = 14;
/** Upper bound on tiles drawn at once, nearest the view centre first. */
export const MAX_VISIBLE_TILES = 24;

const BUILDING_TOKEN = "var(--color-map-building)";
const BUILDING_ALPHA = 200;

const MATERIAL = {
  ambient: 0.32,
  diffuse: 0.55,
  shininess: 8,
  specularColor: [36, 38, 44] as [number, number, number],
};

const EMPTY: string[] = [];

export default function BuildingsLayer() {
  const { viewport } = useMapContext();
  const [index, setIndex] = useState<BuildingsIndex | null>(null);
  const [tiles, setTiles] = useState<ReadonlyMap<string, Building[]>>(() => new Map());
  const mapRevision = useMapRevision();

  // Reloads the index (and drops the drawn tiles) when the simulator switches maps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mapRevision` is the reload trigger, not an input.
  useEffect(() => {
    let live = true;
    setTiles(new Map());
    loadBuildingsIndex().then((loaded) => {
      if (live) setIndex(loaded);
    });
    return () => {
      live = false;
    };
  }, [mapRevision]);

  const available = useMemo(() => new Set(index?.tiles ?? []), [index]);

  // The visible tile set as one string, so the per-frame viewport only causes
  // work when the set of tiles actually changes.
  const zoom = viewport?.zoom ?? 0;
  const keyString =
    index && viewport && zoom >= BUILDINGS_MIN_ZOOM
      ? tilesInView(
          viewport.getBounds() as [number, number, number, number],
          index,
          MAX_VISIBLE_TILES,
          available
        ).join(",")
      : "";
  const keys = useMemo(() => (keyString ? keyString.split(",") : EMPTY), [keyString]);

  useEffect(() => {
    if (!index) return;
    let live = true;
    const wanted = new Set(keys);
    // Drop tiles that left the view; the module cache keeps recent ones, so
    // panning back is a cache hit rather than a refetch.
    setTiles((prev) => {
      if ([...prev.keys()].every((k) => wanted.has(k))) return prev;
      return new Map([...prev].filter(([k]) => wanted.has(k)));
    });
    for (const key of keys) {
      loadTile(key, index).then((buildings) => {
        if (!live) return;
        setTiles((prev) => {
          if (prev.get(key) === buildings) return prev;
          return new Map(prev).set(key, buildings);
        });
      });
    }
    return () => {
      live = false;
    };
  }, [index, keys]);

  const fillColor = useMemo(() => resolveMapColor(BUILDING_TOKEN, BUILDING_ALPHA), []);

  const layers = useMemo(
    () =>
      keys.flatMap((key) => {
        const data = tiles.get(key);
        if (!data || data.length === 0) return [];
        return [
          new SolidPolygonLayer<Building>({
            id: `buildings-${key}`,
            data,
            extruded: true,
            filled: true,
            wireframe: false,
            positionFormat: "XY",
            getPolygon: (d) => d.polygon,
            getElevation: (d) => d.height,
            getFillColor: fillColor,
            material: MATERIAL,
            pickable: false,
          }),
        ];
      }),
    [keys, tiles, fillColor]
  );

  useRegisterLayers("buildings", layers);

  return null;
}
