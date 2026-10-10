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
import { adjustArea, clearAreaDraft, drawArea, getAreaDraft, selectArea } from "./areaDraft";
import { bboxAreaKm2 } from "./bbox";
import MapsPanel from "./MapsPanel";
import { resetMapsStore } from "./mapsStore";

const PORTO_BBOX = [-8.69, 41.13, -8.55, 41.19];
const PORTO_OUTLINE = [
  [
    [
      [-8.68, 41.14],
      [-8.56, 41.14],
      [-8.56, 41.18],
      [-8.68, 41.18],
      [-8.68, 41.14],
    ],
  ],
];
const BRAGA_BBOX = [-8.5, 41.5, -8.35, 41.6];
// A district far over the 2,500 km² cap.
const ALENTEJO_BBOX = [-9, 38, -7, 39.5];

type Route = Reply | ((i: { url: URL; body: unknown }) => Reply | Promise<Reply>);

function server(routes: Record<string, Route> = {}) {
  return mockMapsServer({
    "GET /maps": { body: libraryBody([makeMap()], "nairobi") },
    "GET /maps/presets": { body: { presets: [] } },
    "GET /maps/jobs": { body: { jobs: [] } },
    "GET /maps/geofabrik": {
      body: {
        regions: [
          {
            path: "europe/portugal",
            name: "Portugal",
            areaKm2: 92_000,
            sizeBytes: 380 * 1024 ** 2,
          },
          { path: "europe", name: "Europe", areaKm2: 20_000_000 },
        ],
      },
    },
    "GET /maps/geocode": {
      body: {
        results: [
          { name: "Porto, Portugal", bbox: PORTO_BBOX, type: "place/city", outline: PORTO_OUTLINE },
          { name: "Braga, Portugal", bbox: BRAGA_BBOX, type: "place/city" },
          { name: "Alentejo, Portugal", bbox: ALENTEJO_BBOX, type: "boundary/administrative" },
        ],
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

async function search(user: ReturnType<typeof userEvent.setup>, q = "Porto") {
  await user.type(screen.getByLabelText("Place"), q);
  return screen.findByRole("button", { name: /Porto, Portugal/ }, { timeout: 2000 });
}

beforeEach(() => {
  resetMapsStore();
  clearAreaDraft();
  vi.clearAllMocks();
});

describe("New map form", () => {
  it("opens as a dialog with just a place search", async () => {
    server();
    await openForm();
    expect(screen.getByRole("dialog", { name: "New map" })).toBeInTheDocument();
    expect(screen.getByLabelText("Place")).toHaveFocus();
    // jsdom has no WebGL2: the search still works without the world map.
    expect(screen.getByText(/cannot draw the world map/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
  });

  it("shows the top result live, previews a hovered one, and never moves the simulation map", async () => {
    const setBounds = vi.spyOn(controlsRef, "setBounds");
    const { calls } = server();
    const user = await openForm();
    await search(user);
    // Debounced: one request for the whole word.
    expect(calls.filter((c) => c.path.startsWith("/maps/geocode"))).toHaveLength(1);
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();

    // The top hit is on the map as soon as it arrives, outline and all.
    expect(getAreaDraft().preview).toEqual({ bbox: PORTO_BBOX, outline: PORTO_OUTLINE });
    const focused = getAreaDraft().focus?.seq;

    await user.hover(screen.getByRole("button", { name: /Braga, Portugal/ }));
    expect(getAreaDraft().preview?.bbox).toEqual(BRAGA_BBOX);
    expect(getAreaDraft().focus?.seq).toBeGreaterThan(focused ?? 0);
    // Nothing is chosen until a click.
    expect(getAreaDraft().bbox).toBeNull();
    expect(setBounds).not.toHaveBeenCalled();
  });

  it("builds exactly the picked place's box from the smallest extract", async () => {
    const { calls } = server({
      "POST /maps": {
        status: 202,
        body: { id: "job-2", status: "queued", step: "queued", progress: 0, label: "Porto" },
      },
    });
    const user = await openForm();
    await user.click(await search(user));

    expect(getAreaDraft()).toMatchObject({ bbox: PORTO_BBOX, outline: PORTO_OUTLINE });
    expect(screen.getByLabelText("Name")).toHaveValue("Porto");
    expect(await screen.findByText("Portugal")).toBeInTheDocument();
    expect(screen.getByText("380.0 MB")).toBeInTheDocument();
    expect(getAreaDraft().extract.selected).toBe("europe/portugal");
    expect(calls.find((c) => c.path.startsWith("/maps/geofabrik"))?.path).toBe(
      `/maps/geofabrik?bbox=${PORTO_BBOX.join(",")}`
    );

    await user.click(screen.getByRole("switch", { name: "Include 3D buildings" }));
    await user.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      label: "Porto",
      bbox: PORTO_BBOX,
      geofabrik: "europe/portugal",
      buildings: false,
      activate: false,
    });
    // Back on the library, with the area gone.
    expect(await screen.findByRole("list", { name: "Map library" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getAreaDraft().bbox).toBeNull();
    expect(toast.info).toHaveBeenCalledWith("Map build started");
  });

  it("builds the box as adjusted on the map", async () => {
    const { calls } = server({
      "POST /maps": {
        status: 202,
        body: { id: "job-3", status: "queued", step: "queued", progress: 0, label: "Porto" },
      },
    });
    const user = await openForm();
    await user.click(await search(user));
    const adjusted: [number, number, number, number] = [-8.66, 41.14, -8.58, 41.18];
    act(() => adjustArea(adjusted));
    await screen.findByText("Portugal");
    await waitFor(() => expect(screen.getByRole("button", { name: "Build" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ bbox: adjusted });
  });

  it("trims a place larger than the cap to an available box around its centre", async () => {
    server();
    const user = await openForm();
    await search(user);
    await user.click(screen.getByRole("button", { name: /Alentejo, Portugal/ }));

    const [w, s, e, n] = getAreaDraft().bbox as [number, number, number, number];
    expect(bboxAreaKm2([w, s, e, n])).toBeLessThanOrEqual(2500);
    expect(bboxAreaKm2([w, s, e, n])).toBeGreaterThan(2400);
    expect((w + e) / 2).toBeCloseTo(-8, 4);
    expect((s + n) / 2).toBeCloseTo(38.75, 4);
    expect(screen.getByText(/Alentejo is larger than the 2,500 km² limit/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Build" })).toBeEnabled());
  });

  it("explains a border crossing and warns about a large download", async () => {
    server({
      "GET /maps/geofabrik": {
        body: {
          regions: [
            { path: "europe/italy", name: "Italy", areaKm2: 1_200_000, sizeBytes: 2.1 * 1024 ** 3 },
            { path: "europe", name: "Europe", areaKm2: 20_000_000 },
          ],
          crosses: [
            { path: "europe/italy/nord-ovest", name: "Nord-Ovest" },
            { path: "europe/italy/nord-est", name: "Nord-Est" },
          ],
        },
      },
    });
    const user = await openForm();
    await user.click(await search(user));
    expect(
      await screen.findByText(
        "The box crosses from Nord-Ovest into Nord-Est, so the whole of Italy is downloaded."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/That is a large download/)).toBeInTheDocument();
    expect(screen.getByText("2.1 GB")).toBeInTheDocument();
  });

  it("says which extracts a box spans when none holds it all", async () => {
    server({
      "GET /maps/geofabrik": {
        body: {
          regions: [],
          crosses: [
            { path: "europe/turkey", name: "Turkey" },
            { path: "asia/georgia", name: "Georgia" },
          ],
        },
      },
    });
    const user = await openForm();
    await user.click(await search(user));
    const reasons = await screen.findByRole("list", { name: "Why the map cannot be built yet" });
    await waitFor(() =>
      expect(
        within(reasons).getByText(/it spans Turkey into Georgia, which share no extract/)
      ).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
  });

  it("asks for a name", async () => {
    server();
    const user = await openForm();
    await user.click(await search(user));
    await user.clear(screen.getByLabelText("Name"));
    expect(await screen.findByText("Give the map a name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
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
    await user.type(screen.getByLabelText("Place"), "Porto");
    expect(
      await screen.findByText(/The place search is busy/, undefined, { timeout: 2000 })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Porto, Portugal/ }, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(n).toBe(2);
  });

  it("shows the server's refusal and keeps the form", async () => {
    server({
      "POST /maps": { status: 507, body: { error: "The map library is over its disk quota" } },
    });
    const user = await openForm();
    await user.click(await search(user));
    await screen.findByText("Portugal");
    await user.click(screen.getByRole("button", { name: "Build" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The map library is over its disk quota"
    );
    expect(screen.getByRole("form", { name: "New map" })).toBeInTheDocument();
  });

  it("builds from a chosen larger extract instead of the smallest", async () => {
    const { calls } = server({
      "POST /maps": {
        status: 202,
        body: { id: "job-4", status: "queued", step: "queued", progress: 0, label: "Porto" },
      },
    });
    const user = await openForm();
    await user.click(await search(user));
    const smallest = await screen.findByRole("radio", { name: /Portugal/ });
    expect(smallest).toBeChecked();
    expect(screen.getByText("smallest")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Europe/ }));
    expect(screen.getByRole("radio", { name: /Europe/ })).toBeChecked();
    expect(getAreaDraft().extract.selected).toBe("europe");

    await user.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      label: "Porto",
      bbox: PORTO_BBOX,
      geofabrik: "europe",
      buildings: true,
      activate: false,
    });
  });

  it("falls back to the smallest extract when the chosen one no longer holds the box", async () => {
    let lookups = 0;
    server({
      "GET /maps/geofabrik": () =>
        ++lookups === 1
          ? {
              body: {
                regions: [
                  { path: "europe/portugal", name: "Portugal", areaKm2: 92_000 },
                  { path: "europe", name: "Europe", areaKm2: 20_000_000 },
                ],
              },
            }
          : { body: { regions: [{ path: "europe/spain", name: "Spain", areaKm2: 500_000 }] } },
    });
    const user = await openForm();
    await user.click(await search(user));
    await user.click(await screen.findByRole("radio", { name: /Europe/ }));
    act(() => adjustArea([-7, 41, -6.9, 41.1]));
    expect(await screen.findByRole("radio", { name: /Spain/ })).toBeChecked();
    await waitFor(() => expect(getAreaDraft().extract.selected).toBe("europe/spain"));
  });

  it("builds a box drawn on the map, and names a preset's box after it", async () => {
    const { calls } = server({
      "POST /maps": {
        status: 202,
        body: { id: "job-5", status: "queued", step: "queued", progress: 0, label: "Douro" },
      },
    });
    const user = await openForm();
    await search(user);
    await user.click(screen.getByRole("button", { name: /Alentejo, Portugal/ }));
    expect(screen.getByText(/is larger than the 2,500 km² limit/)).toBeInTheDocument();

    const drawn: [number, number, number, number] = [-7.9, 41.1, -7.7, 41.2];
    act(() => drawArea(drawn));
    // Not the searched place any more: its notes go.
    expect(screen.queryByText(/is larger than the 2,500 km² limit/)).toBeNull();
    expect(screen.getByLabelText("West")).toHaveValue("-7.9");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Douro");
    await screen.findByText("Portugal");
    await user.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      label: "Douro",
      bbox: drawn,
      geofabrik: "europe/portugal",
    });
  });

  it("names the map after a preset picked on the map, until the name is edited", async () => {
    server();
    await openForm();
    act(() => selectArea([32.5, 0.25, 32.7, 0.4], undefined, { kind: "preset", name: "Kampala" }));
    expect(await screen.findByLabelText("Name")).toHaveValue("Kampala");
  });

  describe("typed bounds", () => {
    it("applies typed bounds as the box and flies to it, on Enter", async () => {
      server();
      const user = await openForm();
      expect(getAreaDraft().bbox).toBeNull();
      await user.type(screen.getByLabelText("West"), "-8.66");
      await user.type(screen.getByLabelText("South"), "41.14");
      await user.type(screen.getByLabelText("East"), "-8.58");
      await user.type(screen.getByLabelText("North"), "41.18");
      expect(screen.getByText("Press Enter or Apply to use these bounds.")).toBeInTheDocument();
      // Not yet: typing alone does not move the map.
      expect(getAreaDraft().bbox).toBeNull();
      await user.keyboard("{Enter}");
      expect(getAreaDraft().bbox).toEqual([-8.66, 41.14, -8.58, 41.18]);
      expect(getAreaDraft().focus?.bbox).toEqual([-8.66, 41.14, -8.58, 41.18]);
      expect(getAreaDraft().source?.kind).toBe("bounds");
      // Enter applied the bounds; it did not submit the form.
      expect(screen.getByRole("form", { name: "New map" })).toBeInTheDocument();
      expect(screen.queryByText("Press Enter or Apply to use these bounds.")).toBeNull();
    });

    it("follows the box as it is searched or adjusted on the map", async () => {
      server();
      const user = await openForm();
      await user.click(await search(user));
      expect(screen.getByLabelText("West")).toHaveValue(String(PORTO_BBOX[0]));
      expect(screen.getByLabelText("North")).toHaveValue(String(PORTO_BBOX[3]));
      act(() => adjustArea([-8.123456789, 41.1, -8.0, 41.2]));
      expect(screen.getByLabelText("West")).toHaveValue("-8.12346");
      expect(screen.getByLabelText("East")).toHaveValue("-8");

      // Edited with Apply: the map moves to the new bounds.
      await user.clear(screen.getByLabelText("East"));
      await user.type(screen.getByLabelText("East"), "-8.05");
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(getAreaDraft().bbox).toEqual([-8.12346, 41.1, -8.05, 41.2]);
    });

    it.each([
      ["West", "-8.5", "West must be less than East."],
      ["North", "95", "North must be between -90 and 90."],
      ["South", "x", "South is not a number."],
      ["West", "-40", "over the 2,500 km² limit."],
    ])("refuses %s = %s", async (field, value, error) => {
      server();
      const user = await openForm();
      await user.click(await search(user));
      const before = getAreaDraft().bbox;
      await user.clear(screen.getByLabelText(field));
      await user.type(screen.getByLabelText(field), value);
      expect(screen.getByText(new RegExp(error.replace(/\./g, "\\.")))).toBeInTheDocument();
      expect(screen.getByLabelText(field)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
      await user.keyboard("{Enter}");
      expect(getAreaDraft().bbox).toEqual(before);
    });
  });

  it("drops the area when the dialog closes, by Cancel or Esc", async () => {
    server();
    const user = await openForm();
    await user.click(await search(user));
    expect(getAreaDraft().bbox).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(getAreaDraft().bbox).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "New map" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("list", { name: "Map library" })).toBeInTheDocument();
  });
});
