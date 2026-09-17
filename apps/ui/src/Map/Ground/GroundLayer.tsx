import { useMemo, useRef } from "react";
import { BitmapLayer, PathLayer } from "@deck.gl/layers";
import type { RoadNetwork } from "@/types";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";
import {
  degreesPerPixel,
  graticuleLod,
  graticulePaths,
  snapBounds,
  type GeoBounds,
  type GraticulePath,
} from "./graticule";
import { bloomImage, fieldToRgba, padBounds, rasterizeDensity, smoothField } from "./groundBloom";

/**
 * The map's ground, in geographic coordinates.
 *
 * Both pieces used to be CSS on the element behind the (transparent) deck.gl
 * canvas — a repeating 160px grid tile and a radial gradient pinned to the
 * viewport — so the ground stayed nailed to the screen while everything drawn
 * on it moved. Here they are deck.gl layers in lng/lat, registered into the
 * manager's underlay band so they sit beneath the road network:
 *
 * - **bloom** — a bitmap rasterised from the road network's own vertex density,
 *   anchored to the network's bounding box. The lit area is the city rather
 *   than the middle of the window.
 * - **graticule** — two tiers of lat/lon lines on a 1-2-5 degree ladder. The
 *   half-step tier fades in across the upper half of each rung, so zooming
 *   thickens the grid continuously instead of swapping it in one frame.
 *
 * The vignette stays in CSS. It is a lens, and a lens belongs to the screen.
 */

/** Fallback zoom before the map has published a view state. */
const DEFAULT_ZOOM = 12;

/** Alpha (0-255) of the solid grid tier, and of the half-step tier at full fade. */
const COARSE_ALPHA = 24;
const FINE_ALPHA = 13;

/**
 * Half-width of the box the grid is built over, in pixels. Comfortably wider
 * than any viewport: the block snap below already overshoots, and over-building
 * a few lines costs far less than a grid that ends mid-screen.
 */
const GRID_HALF_SPAN_PX = 1600;

interface GroundLayerProps {
  network: RoadNetwork;
}

/** Bounding box of every coordinate in the network, or null if it has none. */
function networkBounds(network: RoadNetwork): GeoBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of network.features) {
    for (const [lng, lat] of feature.geometry.coordinates as [number, number][]) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west) || east <= west || north <= south) return null;
  return [
    [west, south],
    [east, north],
  ];
}

/** Every vertex in the network, without materialising a copy of them all. */
function* networkVertices(network: RoadNetwork): Generator<readonly [number, number]> {
  for (const feature of network.features) {
    yield* feature.geometry.coordinates as [number, number][];
  }
}

/** True when two boxes are the same to the last bit — they are snapped, so an
 * exact compare is the right one: a crossed block changes them by a whole step. */
function sameBounds(a: GeoBounds | null, b: GeoBounds | null): boolean {
  if (!a || !b) return a === b;
  return a[0][0] === b[0][0] && a[0][1] === b[0][1] && a[1][0] === b[1][0] && a[1][1] === b[1][1];
}

/**
 * The snapped box the grid is built over, held stable across frames that did
 * not move it. Writing through the ref during render is safe here because the
 * computation is pure and idempotent: two renders of the same view state
 * produce the same box.
 */
function useStableBounds(
  ref: React.RefObject<GeoBounds | null>,
  viewState: { longitude?: number; latitude?: number } | null,
  zoom: number,
  step: number
): GeoBounds | null {
  let next: GeoBounds | null = null;
  if (viewState && viewState.longitude != null && viewState.latitude != null) {
    // A generous box around the centre: the exact viewport isn't available here
    // without re-deriving it, and the block snap already overshoots.
    const span = degreesPerPixel(zoom) * GRID_HALF_SPAN_PX;
    next = snapBounds(
      [
        [viewState.longitude - span, viewState.latitude - span],
        [viewState.longitude + span, viewState.latitude + span],
      ],
      step
    );
  }
  if (!sameBounds(ref.current, next)) ref.current = next;
  return ref.current;
}

export default function GroundLayer({ network }: GroundLayerProps) {
  const { viewState } = useMapContext();
  const zoom = viewState?.zoom ?? DEFAULT_ZOOM;

  // Built once per network load: bbox pass, density raster, blur, upscale.
  const bloom = useMemo(() => {
    const bounds = networkBounds(network);
    if (!bounds) return null;
    const padded = padBounds(bounds);
    const field = smoothField(rasterizeDensity(networkVertices(network), padded));
    const lift = resolveMapColor("var(--color-map-lift)");
    const core = resolveMapColor("var(--color-map-bloom-core)");
    const image = bloomImage(fieldToRgba(field, lift, core));
    if (!image) return null;
    const [[west, south], [east, north]] = padded;
    return { image, bounds: [west, south, east, north] as [number, number, number, number] };
  }, [network]);

  const lod = graticuleLod(zoom);

  // The grid is built over a box snapped to whole blocks, and the *same array*
  // is handed back until the view actually crosses one. Panning changes
  // `viewState` every animation frame; a fresh box per frame would rebuild the
  // paths and re-upload the layer 60x a second for a grid that hasn't moved.
  const boundsRef = useRef<GeoBounds | null>(null);
  const snapped = useStableBounds(boundsRef, viewState, zoom, lod.coarse);

  const layers = useMemo(() => {
    const built = [];

    if (bloom) {
      built.push(
        new BitmapLayer({
          id: "ground-bloom",
          image: bloom.image,
          bounds: bloom.bounds,
          pickable: false,
        })
      );
    }

    if (snapped) {
      const grid = resolveMapColor("var(--color-map-graticule)");
      const coarse: GraticulePath[] = graticulePaths(snapped, lod.coarse);
      const fine: GraticulePath[] =
        lod.fineFade > 0.01 ? graticulePaths(snapped, lod.fine, lod.coarse) : [];

      if (fine.length > 0) {
        built.push(
          new PathLayer<GraticulePath>({
            id: "graticule-fine",
            data: fine,
            getPath: (d) => d as unknown as [number, number][],
            getColor: [grid[0], grid[1], grid[2], Math.round(FINE_ALPHA * lod.fineFade)],
            getWidth: 1,
            widthUnits: "pixels",
            widthMinPixels: 1,
            pickable: false,
            updateTriggers: { getColor: lod.fineFade },
          })
        );
      }
      built.push(
        new PathLayer<GraticulePath>({
          id: "graticule-coarse",
          data: coarse,
          getPath: (d) => d as unknown as [number, number][],
          getColor: [grid[0], grid[1], grid[2], COARSE_ALPHA],
          getWidth: 1,
          widthUnits: "pixels",
          widthMinPixels: 1,
          pickable: false,
        })
      );
    }

    return built;
  }, [bloom, snapped, lod.coarse, lod.fine, lod.fineFade]);

  useRegisterLayers("ground", layers);

  return null;
}
