import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { libraryBody, makeMap, mockMapsServer, type Reply } from "@/test/mocks/mapsServer";

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast, toErrorMessage: (_: unknown, f: string) => f }));

vi.mock("@/utils/client", async () => {
  const { createMockClient } = await import("@/test/mocks/client");
  return { default: createMockClient() };
});

import { controlsRef } from "@/components/Map/providers/controls";
import { getAreaDraft, setDraftArea } from "./areaDraft";
import MapsPanel from "./MapsPanel";
import { resetMapsStore } from "./mapsStore";

const LISBON_BBOX = [-9.25, 38.69, -9.09, 38.8];
const PORTO_BBOX = [-8.69, 41.13, -8.55, 41.19];

const PRESETS = {
  presets: [
    {
      name: "lisbon",
      label: "Lisbon",
      bbox: LISBON_BBOX,
      geofabrik: "europe/portugal",
      areaKm2: 170,
    },
    { name: "texas", label: "Texas", bbox: [-106, 26, -93, 36], areaKm2: 690_000 },
  ],
};

type Route = Reply | ((i: { url: URL; body: unknown }) => Reply | Promise<Reply>);

function server(routes: Record<string, Route> = {}) {
  return mockMapsServer({
    "GET /maps": { body: libraryBody([makeMap()], "nairobi") },
    "GET /maps/presets": { body: PRESETS },
    "GET /maps/jobs": { body: { jobs: [] } },
    "GET /maps/geofabrik": {
      body: {
        regions: [
          { path: "europe/portugal", name: "Portugal" },
          { path: "europe", name: "Europe" },
        ],
      },
    },
    "GET /maps/geocode": {
      body: {
        results: [{ name: "Porto, Portugal", bbox: PORTO_BBOX, type: "place/city" }],
        attribution: "Data © OpenStreetMap contributors, ODbL 1.0.",
      },
    },
    ...routes,
  });
}

async function openForm() {
  const user = userEvent.setup();
  render(<MapsPanel />);
  await user.click(await screen.findByRole("button", { name: "New map" }));
  return user;
}

beforeEach(() => {
  resetMapsStore();
  setDraftArea(null, null);
  vi.clearAllMocks();
});

describe("New map form", () => {
  it("builds a preset, previewing its area on the map", async () => {
    const setBounds = vi.spyOn(controlsRef, "setBounds");
    const { calls } = server({
      "POST /maps": {
        status: 202,
        body: { id: "job-9", status: "queued", step: "queued", progress: 0, label: "Lisbon" },
      },
    });
    const user = await openForm();
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Lisbon/ }));
    expect(getAreaDraft()).toMatchObject({ bbox: LISBON_BBOX, origin: "preset" });
    expect(setBounds).toHaveBeenCalledWith([
      [-9.25, 38.69],
      [-9.09, 38.8],
    ]);
    expect(screen.getByText("of 2,500 km² max").parentElement).toHaveTextContent(
      "170 km² of 2,500 km² max"
    );
    expect(screen.getByText("europe/portugal")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Lisbon");

    await user.click(screen.getByRole("switch", { name: "Include 3D buildings" }));
    await user.click(screen.getByRole("button", { name: "Build" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      preset: "lisbon",
      label: "Lisbon",
      buildings: false,
      activate: false,
    });
    // Back on the library, with the preview gone.
    expect(await screen.findByRole("list", { name: "Map library" })).toBeInTheDocument();
    expect(getAreaDraft().bbox).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("Map build started");
  });

  it("blocks an area over the server's cap", async () => {
    server();
    const user = await openForm();
    await user.click(screen.getByRole("button", { name: /Texas/ }));
    expect(screen.getByText(/over the 2,500 km² limit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
  });

  it("finds a place, resolves its source extract and builds it", async () => {
    const { calls } = server({
      "POST /maps": {
        status: 202,
        body: { id: "job-2", status: "queued", step: "queued", progress: 0, label: "Porto" },
      },
    });
    const user = await openForm();
    await user.click(screen.getByRole("tab", { name: "Search" }));
    await user.type(screen.getByLabelText("Place"), "Porto");

    const place = await screen.findByRole("button", { name: /Porto, Portugal/ }, { timeout: 2000 });
    // Debounced: one request for the whole word.
    expect(calls.filter((c) => c.path.startsWith("/maps/geocode"))).toHaveLength(1);
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();

    await user.click(place);
    expect(getAreaDraft()).toMatchObject({ bbox: PORTO_BBOX, origin: "search" });
    expect(screen.getByLabelText("Name")).toHaveValue("Porto");

    // Two extracts contain it: the smallest (listed first) is picked.
    const smallest = await screen.findByRole("radio", { name: /europe\/portugal/ });
    expect(smallest).toBeChecked();
    expect(screen.getByRole("radio", { name: /^europe$/ })).not.toBeChecked();
    expect(calls.find((c) => c.path.startsWith("/maps/geofabrik"))?.path).toBe(
      `/maps/geofabrik?bbox=${PORTO_BBOX.join(",")}`
    );

    await user.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      label: "Porto",
      bbox: PORTO_BBOX,
      geofabrik: "europe/portugal",
      buildings: true,
      activate: false,
    });
  });

  it("waits and retries once when the geocoder is rate limited", async () => {
    let n = 0;
    server({
      "GET /maps/geocode": () =>
        ++n === 1
          ? { status: 429, body: { error: "Too many requests" } }
          : { body: { results: [{ name: "Porto, Portugal", bbox: PORTO_BBOX }] } },
    });
    const user = await openForm();
    await user.click(screen.getByRole("tab", { name: "Search" }));
    await user.type(screen.getByLabelText("Place"), "Porto");

    expect(
      await screen.findByText(/The place search is busy/, undefined, { timeout: 2000 })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Porto, Portugal/ }, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(n).toBe(2);
  });

  it("blocks an area no Geofabrik extract covers", async () => {
    server({ "GET /maps/geofabrik": { body: { regions: [] } } });
    const user = await openForm();
    await user.click(screen.getByRole("tab", { name: "Draw" }));
    await user.type(screen.getByLabelText("Name"), "Atlantis");
    act(() => setDraftArea([-30, 30, -29.9, 30.1], "draw"));

    const reasons = await screen.findByRole("list", { name: "Why the map cannot be built yet" });
    await waitFor(() =>
      expect(
        within(reasons).getByText("No Geofabrik extract covers this area.")
      ).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
  });

  it("asks for a name for a custom area", async () => {
    server();
    const user = await openForm();
    await user.click(screen.getByRole("tab", { name: "Draw" }));
    act(() => setDraftArea(PORTO_BBOX as [number, number, number, number], "draw"));
    expect(await screen.findByText("Give the map a name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
  });

  it("enters draw mode and shows the server's refusal", async () => {
    server({
      "POST /maps": { status: 507, body: { error: "The map library is over its disk quota" } },
    });
    const user = await openForm();
    await user.click(screen.getByRole("tab", { name: "Draw" }));
    await user.click(screen.getByRole("button", { name: "Draw on map" }));
    expect(getAreaDraft().drawing).toBe(true);
    expect(screen.getByText("Drag a rectangle on the map. Esc cancels.")).toBeInTheDocument();

    act(() => setDraftArea(PORTO_BBOX as [number, number, number, number], "draw"));
    await user.type(screen.getByLabelText("Name"), "Porto");
    await screen.findByRole("radio", { name: /europe\/portugal/ });
    await user.click(screen.getByRole("button", { name: "Build" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The map library is over its disk quota"
    );
    expect(screen.getByRole("form", { name: "New map" })).toBeInTheDocument();
  });

  it("drops the preview when the form closes", async () => {
    server();
    const user = await openForm();
    await user.click(screen.getByRole("button", { name: /Lisbon/ }));
    expect(getAreaDraft().bbox).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(getAreaDraft().bbox).toBeNull();
  });
});
