import { useMemo } from "react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { JobDTO, Position } from "@/types";
import { resolveMapColor } from "@/lib/mapColor";
import {
  LABEL_PRIORITY,
  LABEL_TOKEN,
  mapLabelProps,
  useVisibleLabels,
  type LabelItem,
} from "@/lib/mapLabels";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useSettledZoom } from "../hooks/useSettledZoom";

export const JOBS_LAYER_ID = "jobs";

type RGBA = [number, number, number, number];

function withAlpha(token: string, alpha: number): RGBA {
  const [r, g, b] = resolveMapColor(token);
  return [r, g, b, alpha];
}

/**
 * Job stop colours. Pickup is where the load is collected (`ok` green), dropoff
 * where it lands (`trail` blue) — the same two hues the breadcrumb/route
 * overlays already use for "travelled" vs "target". A job past its SLA repaints
 * both ends in the danger hue so lateness is visible on the map, not only in
 * the panel.
 */
export const JOB_COLOR_TOKENS = {
  pickup: "var(--color-overlay-ok)",
  dropoff: "var(--color-overlay-trail)",
  late: "var(--color-overlay-danger)",
  draft: "var(--color-overlay-warning)",
} as const;

/** Key of the draft marker in the pickup layer's data. */
const DRAFT_KEY = "draft";

/** Label size and offset, shared between the TextLayer and the declutter pass. */
const LABEL_SIZE = 11;
const LABEL_OFFSET: [number, number] = [0, -11];

/** A job past its SLA outranks the rest of the queue for label space. */
const LATE_LABEL_BOOST = 5;

/**
 * Which token a stop paints with. Split out from the accessors (and exported)
 * because the *decision* is the logic worth testing: under jsdom
 * `getComputedStyle` returns no theme values, so every token resolves to the
 * same fallback grey and comparing resolved rgba proves nothing.
 */
export function tokenForStop(
  stop: { key: string; late: boolean },
  kind: "pickup" | "dropoff"
): string {
  if (stop.key === DRAFT_KEY) return JOB_COLOR_TOKENS.draft;
  if (stop.late) return JOB_COLOR_TOKENS.late;
  return kind === "pickup" ? JOB_COLOR_TOKENS.pickup : JOB_COLOR_TOKENS.dropoff;
}

/** The link line and the reference label follow the pickup/late decision. */
export function tokenForLink(link: { late: boolean }): string {
  return link.late ? JOB_COLOR_TOKENS.late : JOB_COLOR_TOKENS.dropoff;
}

/** Stable empty array so an inactive memo never re-registers. */
const NO_LAYERS: Layer[] = [];

interface StopDatum {
  key: string;
  /** `[lng, lat]`, deck.gl order. */
  position: [number, number];
  late: boolean;
}

interface LinkDatum {
  path: [number, number][];
  late: boolean;
}

interface LabelDatum {
  key: string;
  position: [number, number];
  text: string;
  late: boolean;
}

/** Store/DTO positions are `[lat, lng]`; deck.gl wants `[lng, lat]`. */
function toDeck(position: Position): [number, number] {
  return [position[1], position[0]];
}

interface JobsLayerProps {
  /** Live jobs only — finished ones are history and would clutter the map. */
  jobs: JobDTO[];
  /**
   * Pickup already placed in an in-progress "new job" placement, drawn in the
   * draft hue so the operator can see the first click landed before the second.
   */
  draftPickup?: Position | null;
}

/**
 * Pickup/dropoff markers for live jobs, plus the link line between each pair.
 *
 * Mounted from `Map.tsx` behind the `showJobs` visibility toggle. Purely
 * derived from the job board — no picking, no interaction: the panel owns job
 * actions, this layer only makes the geography of the queue legible.
 *
 * Deliberately not wrapped in `memo()`: it subscribes to the map context, which
 * publishes a new viewport on every pan frame, so the wrapper only ever added a
 * props comparison that could not prevent a render. The memos below are what
 * actually keep the layers stable.
 */
export default function JobsLayer({ jobs, draftPickup }: JobsLayerProps) {
  const { viewport, getZoom } = useMapContext();
  const { settledZoom } = useSettledZoom(getZoom());

  // Job references are decluttered against every other map label, so a dense
  // queue can't bury the selected route's readout (or its own neighbours).
  const labelItems = useMemo<LabelItem[]>(
    () =>
      jobs.map((job) => ({
        id: job.id,
        position: toDeck(job.pickup.position),
        text: job.reference,
        size: LABEL_SIZE,
        priority: LABEL_PRIORITY.job + (job.slaBreached ? LATE_LABEL_BOOST : 0),
        pixelOffset: LABEL_OFFSET,
      })),
    [jobs]
  );

  const visibleLabels = useVisibleLabels(
    `${JOBS_LAYER_ID}-labels`,
    labelItems,
    viewport,
    settledZoom
  );

  // Geometry and labels live in separate memos: a label verdict changes
  // whenever anything anywhere on the map moves, and rebuilding the stop
  // markers and link lines for that would re-upload the whole queue for nothing.
  const geometryLayers = useMemo(() => {
    const pickups: StopDatum[] = [];
    const dropoffs: StopDatum[] = [];
    const links: LinkDatum[] = [];

    for (const job of jobs) {
      const from = toDeck(job.pickup.position);
      const to = toDeck(job.dropoff.position);
      const late = job.slaBreached;
      pickups.push({ key: `${job.id}-p`, position: from, late });
      dropoffs.push({ key: `${job.id}-d`, position: to, late });
      links.push({ path: [from, to], late });
    }

    if (draftPickup) {
      pickups.push({ key: DRAFT_KEY, position: toDeck(draftPickup), late: false });
    }

    if (pickups.length === 0) return NO_LAYERS;

    const result: Layer[] = [];

    if (links.length > 0) {
      result.push(
        new PathLayer<LinkDatum>({
          id: `${JOBS_LAYER_ID}-links`,
          data: links,
          getPath: (d) => d.path,
          getColor: (d) => withAlpha(tokenForLink(d), d.late ? 110 : 90),
          getWidth: 1.5,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: false,
          updateTriggers: { getColor: links.map((l) => l.late) },
        })
      );
    }

    result.push(
      new ScatterplotLayer<StopDatum>({
        id: `${JOBS_LAYER_ID}-pickups`,
        data: pickups,
        getPosition: (d) => d.position,
        getRadius: 6,
        radiusUnits: "pixels",
        getFillColor: (d) => withAlpha(tokenForStop(d, "pickup"), 255),
        getLineColor: withAlpha(LABEL_TOKEN, 255),
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        pickable: false,
        updateTriggers: { getFillColor: pickups.map((p) => `${p.key}:${p.late}`) },
      })
    );

    if (dropoffs.length > 0) {
      // Hollow ring, so pickup (filled) and dropoff (open) are distinguishable
      // by shape and not by colour alone.
      result.push(
        new ScatterplotLayer<StopDatum>({
          id: `${JOBS_LAYER_ID}-dropoffs`,
          data: dropoffs,
          getPosition: (d) => d.position,
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0],
          getLineColor: (d) => withAlpha(tokenForStop(d, "dropoff"), 255),
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          stroked: true,
          filled: false,
          pickable: false,
          updateTriggers: { getLineColor: dropoffs.map((d) => d.late) },
        })
      );
    }

    return result;
  }, [jobs, draftPickup]);

  const labelLayers = useMemo(() => {
    const labels: LabelDatum[] = [];
    for (const job of jobs) {
      if (!visibleLabels.has(job.id)) continue;
      labels.push({
        key: job.id,
        position: toDeck(job.pickup.position),
        text: job.reference,
        late: job.slaBreached,
      });
    }
    if (labels.length === 0) return NO_LAYERS;
    return [
      new TextLayer<LabelDatum>({
        ...mapLabelProps(LABEL_SIZE),
        id: `${JOBS_LAYER_ID}-labels`,
        data: labels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: (d) => withAlpha(d.late ? JOB_COLOR_TOKENS.late : JOB_COLOR_TOKENS.pickup, 255),
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        getPixelOffset: LABEL_OFFSET,
        pickable: false,
        updateTriggers: { getColor: labels.map((l) => l.late) },
      }),
    ];
  }, [jobs, visibleLabels]);

  const layers = useMemo(
    () => (labelLayers.length === 0 ? geometryLayers : [...geometryLayers, ...labelLayers]),
    [geometryLayers, labelLayers]
  );

  useRegisterLayers(JOBS_LAYER_ID, layers);

  return null;
}
