import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";
import type { JobDTO, JobStatus, Position } from "@/types";

// ── Capture registered layers by id ────────────────────────────────
const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

import JobsLayer, {
  JOB_COLOR_TOKENS,
  JOBS_LAYER_ID,
  tokenForLink,
  tokenForStop,
} from "./JobsLayer";

function createJob(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    reference: "JOB-0001",
    status: "en_route" as JobStatus,
    pickup: { position: [-1.29, 36.82] },
    dropoff: { position: [-1.31, 36.85] },
    strategy: "nearest",
    createdAt: 0,
    slaSeconds: 900,
    slaDeadline: 900_000,
    slaBreached: false,
    ...overrides,
  };
}

function renderLayer(jobs: JobDTO[], draftPickup?: Position | null) {
  registeredLayers.clear();
  render(<JobsLayer jobs={jobs} draftPickup={draftPickup} />);
  return (registeredLayers.get(JOBS_LAYER_ID) ?? []) as Layer[];
}

function byIdSuffix(layers: Layer[], suffix: string): Layer | undefined {
  return layers.find((l) => l.id === `${JOBS_LAYER_ID}-${suffix}`);
}

/** deck.gl layer props are accessible off the constructed instance. */
function props(layer: Layer | undefined): Record<string, unknown> {
  return (layer?.props ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  registeredLayers.clear();
});

describe("JobsLayer", () => {
  it("registers nothing when there are no jobs and no draft", () => {
    expect(renderLayer([])).toEqual([]);
  });

  it("draws a pickup, a dropoff, a link and a label per job", () => {
    const layers = renderLayer([createJob()]);

    expect(layers.map((l) => l.id)).toEqual([
      `${JOBS_LAYER_ID}-links`,
      `${JOBS_LAYER_ID}-pickups`,
      `${JOBS_LAYER_ID}-dropoffs`,
      `${JOBS_LAYER_ID}-labels`,
    ]);
  });

  it("converts [lat, lng] job positions to deck.gl [lng, lat]", () => {
    const layers = renderLayer([createJob()]);

    const pickups = props(byIdSuffix(layers, "pickups")).data as { position: number[] }[];
    const dropoffs = props(byIdSuffix(layers, "dropoffs")).data as { position: number[] }[];

    expect(pickups[0].position).toEqual([36.82, -1.29]);
    expect(dropoffs[0].position).toEqual([36.85, -1.31]);
  });

  it("links each pickup to its own dropoff", () => {
    const layers = renderLayer([
      createJob({ id: "a" }),
      createJob({
        id: "b",
        pickup: { position: [-1.2, 36.7] },
        dropoff: { position: [-1.25, 36.75] },
      }),
    ]);

    const links = props(byIdSuffix(layers, "links")).data as { path: number[][] }[];
    expect(links).toHaveLength(2);
    expect(links[0].path).toEqual([
      [36.82, -1.29],
      [36.85, -1.31],
    ]);
    expect(links[1].path).toEqual([
      [36.7, -1.2],
      [36.75, -1.25],
    ]);
  });

  it("labels each job with its operator reference", () => {
    const layers = renderLayer([createJob({ reference: "JOB-ABCD" })]);

    const labels = props(byIdSuffix(layers, "labels")).data as { text: string }[];
    expect(labels.map((l) => l.text)).toEqual(["JOB-ABCD"]);
  });

  it("flags a breached job's stops as late", () => {
    const layers = renderLayer([createJob({ slaBreached: true })]);

    const pickups = props(byIdSuffix(layers, "pickups")).data as { late: boolean }[];
    const dropoffs = props(byIdSuffix(layers, "dropoffs")).data as { late: boolean }[];
    expect(pickups[0].late).toBe(true);
    expect(dropoffs[0].late).toBe(true);
  });

  it("renders the draft pickup as an extra pickup with no dropoff or link", () => {
    const layers = renderLayer([], [-1.4, 36.9]);

    const pickups = props(byIdSuffix(layers, "pickups")).data as { key: string }[];
    expect(pickups).toHaveLength(1);
    expect(pickups[0].key).toBe("draft");
    expect(byIdSuffix(layers, "links")).toBeUndefined();
    expect(byIdSuffix(layers, "dropoffs")).toBeUndefined();
  });

  it("shows the draft pickup alongside existing jobs", () => {
    const layers = renderLayer([createJob()], [-1.4, 36.9]);

    const pickups = props(byIdSuffix(layers, "pickups")).data as { key: string }[];
    expect(pickups.map((p) => p.key)).toEqual(["job-1-p", "draft"]);
    // The draft has no dropoff yet, so the link/dropoff counts stay at one.
    expect((props(byIdSuffix(layers, "dropoffs")).data as unknown[]).length).toBe(1);
  });

  it("paints an on-time pickup and dropoff with their own tokens", () => {
    expect(tokenForStop({ key: "job-1-p", late: false }, "pickup")).toBe(JOB_COLOR_TOKENS.pickup);
    expect(tokenForStop({ key: "job-1-d", late: false }, "dropoff")).toBe(JOB_COLOR_TOKENS.dropoff);
  });

  it("repaints both ends of a late job in the danger token", () => {
    expect(tokenForStop({ key: "job-1-p", late: true }, "pickup")).toBe(JOB_COLOR_TOKENS.late);
    expect(tokenForStop({ key: "job-1-d", late: true }, "dropoff")).toBe(JOB_COLOR_TOKENS.late);
    expect(tokenForLink({ late: true })).toBe(JOB_COLOR_TOKENS.late);
    expect(tokenForLink({ late: false })).toBe(JOB_COLOR_TOKENS.dropoff);
  });

  it("gives the draft pickup its own token regardless of lateness", () => {
    expect(tokenForStop({ key: "draft", late: false }, "pickup")).toBe(JOB_COLOR_TOKENS.draft);
    expect(tokenForStop({ key: "draft", late: true }, "pickup")).toBe(JOB_COLOR_TOKENS.draft);
  });

  it("wires the colour accessors to those decisions", () => {
    const layers = renderLayer([createJob()], [-1.4, 36.9]);
    const pickupProps = props(byIdSuffix(layers, "pickups"));
    const getFillColor = pickupProps.getFillColor as (d: unknown) => number[];

    // jsdom resolves every token to the same fallback, so assert the accessor
    // runs and yields an opaque rgba rather than comparing hues.
    for (const datum of pickupProps.data as unknown[]) {
      expect(getFillColor(datum)).toHaveLength(4);
      expect(getFillColor(datum)[3]).toBe(255);
    }

    const linkProps = props(byIdSuffix(layers, "links"));
    const getColor = linkProps.getColor as (d: unknown) => number[];
    expect(getColor((linkProps.data as unknown[])[0])[3]).toBe(90);
    expect(getColor({ late: true })[3]).toBe(110);
  });

  it("reads each stop's position off the datum", () => {
    const layers = renderLayer([createJob()]);
    const layerProps = props(byIdSuffix(layers, "pickups"));
    const getPosition = layerProps.getPosition as (d: unknown) => number[];

    expect(getPosition((layerProps.data as unknown[])[0])).toEqual([36.82, -1.29]);
  });

  it("reads each link's path and each label's text off the datum", () => {
    const layers = renderLayer([createJob({ reference: "JOB-BEEF" })]);
    const linkProps = props(byIdSuffix(layers, "links"));
    const labelProps = props(byIdSuffix(layers, "labels"));
    const getPath = linkProps.getPath as (d: unknown) => number[][];
    const getText = labelProps.getText as (d: unknown) => string;

    expect(getPath((linkProps.data as unknown[])[0])).toHaveLength(2);
    expect(getText((labelProps.data as unknown[])[0])).toBe("JOB-BEEF");
  });

  it("keeps every layer unpickable — the panel owns job actions", () => {
    const layers = renderLayer([createJob()], [-1.4, 36.9]);

    for (const layer of layers) {
      expect(props(layer).pickable).toBe(false);
    }
  });
});
