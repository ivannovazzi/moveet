import { useMemo, useRef } from "react";
import { BitmapLayer, PathLayer } from "@deck.gl/layers";
import type { RoadNetwork } from "@/types";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";
import {
  degreesPerPixel,
  hexLatticePaths,
  hexLod,
  latitudeSquash,
  snapBounds,
  type GeoBounds,
  type HexPath,
} from "./hexLattice";
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
 * - **lattice** — a honeycomb on a power-of-two ladder, squashed in latitude so
 *   its cells come out regular on screen. Hex lattices don't nest, so the ladder
 *   steps by crossfading two of them rather than by adding detail to one.
 *
 * The vignette stays in CSS. It is a lens, and a lens belongs to the screen.
 */

/** Fallback zoom before the map has published a view state. */
const DEFAULT_ZOOM = 12;

/**
 * Alpha (0-255) of the lattice at full strength. Around 8%: at the sizes the
 * ladder picks, a honeycomb covers a lot more of the screen than a grid of
 * hairlines did, so it has to sit quieter to stay a texture.
 */
const LATTICE_ALPHA = 21;

/**
 * Half-width of the box the lattice is built over, in pixels. Comfortably wider
 * than any viewport: the block snap below already overshoots, and over-building
 * a few cells costs far less than a lattice that ends mid-screen.
 */
const LATTICE_HALF_SPAN_PX = 1600;

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
 * The snapped box the lattice is built over, held stable across frames that did
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
    const span = degreesPerPixel(zoom) * LATTICE_HALF_SPAN_PX;
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

  const lod = hexLod(zoom);
  // Quantized, so panning north or south re-anchors the lattice rarely rather
  // than sliding every row a little on every frame.
  const squash = latitudeSquash(viewState?.latitude ?? 0);

  // The lattice is built over a box snapped to whole blocks, and the *same
  // array* is handed back until the view actually crosses one. Panning changes
  // `viewState` every animation frame; a fresh box per frame would rebuild the
  // paths and re-upload the layer 60x a second for a lattice that hasn't moved.
  const boundsRef = useRef<GeoBounds | null>(null);
  const snapped = useStableBounds(boundsRef, viewState, zoom, lod.primary);

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
      const ink = resolveMapColor("var(--color-map-lattice)");
      // Round caps and joints: at one pixel the difference is small, but it is
      // the difference between a honeycomb that looks drawn and one that looks
      // plotted, and the whole point of the pattern is softness.
      const stroke = {
        getPath: (d: HexPath) => d,
        getWidth: 1,
        widthUnits: "pixels" as const,
        widthMinPixels: 1,
        jointRounded: true,
        capRounded: true,
        pickable: false,
      };

      if (lod.secondary !== null && lod.mix > 0.005) {
        built.push(
          new PathLayer<HexPath>({
            ...stroke,
            id: "hex-lattice-secondary",
            data: hexLatticePaths(snapped, lod.secondary, squash),
            getColor: [ink[0], ink[1], ink[2], Math.round(LATTICE_ALPHA * lod.mix)],
            updateTriggers: { getColor: lod.mix },
          })
        );
      }
      built.push(
        new PathLayer<HexPath>({
          ...stroke,
          id: "hex-lattice-primary",
          data: hexLatticePaths(snapped, lod.primary, squash),
          getColor: [ink[0], ink[1], ink[2], Math.round(LATTICE_ALPHA * (1 - lod.mix))],
          updateTriggers: { getColor: lod.mix },
        })
      );
    }

    return built;
  }, [bloom, snapped, squash, lod.primary, lod.secondary, lod.mix]);

  useRegisterLayers("ground", layers);

  return null;
}
