import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MapStatusPayload } from "@/utils/wsTypes";
import { libraryBody, makeMap, mockMapsServer, type Reply } from "@/test/mocks/mapsServer";

const { toast, wsHandlers } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  wsHandlers: {} as Record<string, (data: unknown) => void>,
}));

vi.mock("@/lib/toast", () => ({ toast, toErrorMessage: (_: unknown, f: string) => f }));

vi.mock("@/utils/client", async () => {
  const { createMockClient } = await import("@/test/mocks/client");
  return {
    default: {
      ...createMockClient(),
      onMap: (h: (d: unknown) => void) => {
        wsHandlers.map = h;
      },
      offMap: vi.fn(),
      onMapJob: (h: (d: unknown) => void) => {
        wsHandlers.mapjob = h;
      },
      offMapJob: vi.fn(),
      onConnect: (h: (d: unknown) => void) => {
        wsHandlers.connect = h;
      },
      offConnect: vi.fn(),
    },
  };
});

import MapsPanel from "./MapsPanel";
import { resetMapsStore, useMapsSync } from "./mapsStore";

function Harness() {
  useMapsSync();
  return <MapsPanel />;
}

const NAIROBI = makeMap();
const LISBON = makeMap({
  id: "lisbon",
  label: "Lisbon",
  bbox: [-9.25, 38.69, -9.09, 38.8],
  source: { type: "geofabrik", path: "europe/portugal" },
  sizes: { networkBytes: 2 * 1024 * 1024, buildingsBytes: 1024 * 1024 },
  featureCount: 8000,
  nodeCount: null,
  hasBuildings: true,
  createdAt: "2026-10-05T10:00:00Z",
});

const PRESETS = {
  presets: [{ name: "lisbon", label: "Lisbon", bbox: [-9.25, 38.69, -9.09, 38.8], areaKm2: 170 }],
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "running",
    step: "download",
    progress: 0.25,
    bytesDownloaded: 10 * 1024 * 1024,
    totalBytes: 40 * 1024 * 1024,
    label: "Porto",
    createdAt: "2026-10-10T10:00:00Z",
    ...overrides,
  };
}

function server(
  routes: Record<string, Reply | ((i: { url: URL; body: unknown }) => Reply | Promise<Reply>)> = {}
) {
  return mockMapsServer({
    "GET /maps": { body: libraryBody([NAIROBI, LISBON], "nairobi") },
    "GET /maps/presets": { body: PRESETS },
    "GET /maps/jobs": { body: { jobs: [] } },
    ...routes,
  });
}

function sendMap(payload: MapStatusPayload) {
  act(() => wsHandlers.map(payload));
}

beforeEach(() => {
  resetMapsStore();
  vi.clearAllMocks();
});

describe("map library", () => {
  it("lists every map with its facts and marks the active one", async () => {
    server();
    render(<Harness />);
    const list = await screen.findByRole("list", { name: "Map library" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const nairobi = within(list).getByRole("listitem", { name: "Nairobi" });
    expect(nairobi).toHaveAttribute("aria-current", "true");
    expect(within(nairobi).getByText("Active")).toBeInTheDocument();
    expect(within(nairobi).queryByRole("button", { name: "Activate Nairobi" })).toBeNull();
    expect(within(nairobi).getByRole("button", { name: "Delete Nairobi" })).toBeDisabled();
    expect(within(nairobi).getByText(/12,000 roads · 30,000 nodes/)).toBeInTheDocument();

    const lisbon = within(list).getByRole("listitem", { name: "Lisbon" });
    expect(within(lisbon).getByText(/3\.0 MB · 8,000 roads · 3D buildings/)).toBeInTheDocument();
    expect(within(lisbon).getByText(/Geofabrik europe\/portugal/)).toBeInTheDocument();
    expect(within(lisbon).getByRole("button", { name: "Activate Lisbon" })).toBeEnabled();
  });

  it("shows disk usage against the quota", async () => {
    server();
    render(<Harness />);
    expect(await screen.findByText("1.0 GB of 5.0 GB")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Map library disk usage" })).toHaveAttribute(
      "aria-valuenow",
      "20"
    );
  });

  it("activates a map, disabling every action until the switch is done", async () => {
    let finish: (r: Reply) => void = () => {};
    const { calls } = server({
      "POST /maps/lisbon/activate": () => new Promise<Reply>((r) => (finish = r)),
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Activate Lisbon" }));

    expect(await screen.findByText("Switching to Lisbon…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate Lisbon" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Lisbon" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New map" })).toBeDisabled();

    await act(async () =>
      finish({
        body: { map: LISBON, previousId: "nairobi", changed: true, durationMs: 900 },
      })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Switched to Lisbon"));
    expect(screen.queryByText("Switching to Lisbon…")).toBeNull();
    expect(calls.some((c) => c.method === "POST" && c.path === "/maps/lisbon/activate")).toBe(true);
  });

  it("surfaces the adapter warning returned by a switch", async () => {
    server({
      "POST /maps/lisbon/activate": {
        body: {
          map: LISBON,
          previousId: "nairobi",
          changed: true,
          durationMs: 900,
          warning: "The adapter's fleet is in another city",
        },
      },
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Activate Lisbon" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The adapter's fleet is in another city"
    );
    expect(toast.info).toHaveBeenCalledWith("The adapter's fleet is in another city", {
      duration: 10_000,
    });
    await user.click(screen.getByRole("button", { name: "Dismiss warning" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("toasts the server's error when a switch fails", async () => {
    server({
      "POST /maps/lisbon/activate": { status: 422, body: { error: "network.geojson is corrupt" } },
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Activate Lisbon" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not switch to Lisbon: network.geojson is corrupt"
      )
    );
  });

  it("follows a switch announced on the map channel", async () => {
    server();
    render(<Harness />);
    await screen.findByRole("button", { name: "Activate Lisbon" });

    sendMap({ status: "switching", map: LISBON });
    expect(screen.getByText("Switching to Lisbon…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate Lisbon" })).toBeDisabled();

    sendMap({ status: "active", map: LISBON });
    expect(toast.success).toHaveBeenCalledWith("Switched to Lisbon");
    expect(screen.queryByText("Switching to Lisbon…")).toBeNull();
  });

  it("toasts the error from a failed switch on the map channel", async () => {
    server();
    render(<Harness />);
    await screen.findByRole("button", { name: "Activate Lisbon" });
    sendMap({ status: "switching", map: LISBON });
    sendMap({ status: "error", map: NAIROBI, error: "out of memory" });
    expect(toast.error).toHaveBeenCalledWith("Could not switch to Lisbon: out of memory");
    expect(screen.getByRole("button", { name: "Activate Lisbon" })).toBeEnabled();
  });

  it("deletes a map only after confirmation", async () => {
    const { calls } = server({ "DELETE /maps/lisbon": { status: 204 } });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Delete Lisbon" }));

    const confirm = screen.getByRole("button", { name: "Confirm deleting Lisbon" });
    expect(confirm).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByRole("button", { name: "Delete Lisbon" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Delete Lisbon" }));
    await user.click(screen.getByRole("button", { name: "Confirm deleting Lisbon" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deleted Lisbon"));
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/maps/lisbon")).toBe(true);
  });

  it("offers a retry when the library cannot be read", async () => {
    server({ "GET /maps": { status: 500, body: { error: "disk on fire" } } });
    render(<Harness />);
    expect(await screen.findByText(/disk on fire/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("feature detection", () => {
  it("hides the New map flow on a server without build support", async () => {
    const { calls } = server({
      "GET /maps": { body: { maps: [NAIROBI, LISBON], activeId: "nairobi", switching: false } },
    });
    render(<Harness />);
    await screen.findByRole("button", { name: "Activate Lisbon" });
    expect(screen.queryByRole("button", { name: "New map" })).toBeNull();
    expect(calls.some((c) => c.path.startsWith("/maps/presets"))).toBe(false);
    expect(calls.some((c) => c.path.startsWith("/maps/jobs"))).toBe(false);
  });

  it("hides the New map flow when the presets endpoint is missing", async () => {
    server({ "GET /maps/presets": { status: 404, body: { error: "Not found" } } });
    render(<Harness />);
    await screen.findByRole("button", { name: "Activate Lisbon" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "New map" })).toBeNull());
    expect(screen.queryByText(/turned off/)).toBeNull();
  });

  it("explains that builds are off instead of showing the form", async () => {
    server({
      "GET /maps": {
        body: libraryBody([NAIROBI, LISBON], "nairobi", {
          buildsAllowed: false,
          buildLimits: { maxAreaKm2: 2500, diskQuotaBytes: 100, diskUsedBytes: 50 },
        }),
      },
    });
    render(<Harness />);
    expect(await screen.findByText(/Building new maps is turned off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New map" })).toBeNull();
    expect(screen.getByRole("button", { name: "Activate Lisbon" })).toBeEnabled();
  });

  it("opens the New map form when builds are on", async () => {
    server();
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "New map" }));
    expect(screen.getByRole("form", { name: "New map" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to library" }));
    expect(screen.getByRole("list", { name: "Map library" })).toBeInTheDocument();
  });
});

describe("build progress", () => {
  it("shows a running build's step, bytes and progress, and cancels it", async () => {
    const { calls } = server({
      "GET /maps/jobs": { body: { jobs: [job()] } },
      "DELETE /maps/jobs/job-1": { status: 202, body: job({ status: "cancelled" }) },
    });
    const user = userEvent.setup();
    render(<Harness />);

    const bar = await screen.findByRole("progressbar", { name: "Porto build progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Downloading extract")).toBeInTheDocument();
    expect(screen.getByText("10.0 MB of 40.0 MB")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel building Porto" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.path === "/maps/jobs/job-1")).toBe(true)
    );
  });

  it("moves with job frames from the WebSocket and announces the outcome", async () => {
    const { calls } = server({ "GET /maps/jobs": { body: { jobs: [job()] } } });
    render(<Harness />);
    await screen.findByRole("progressbar", { name: "Porto build progress" });

    act(() => wsHandlers.mapjob(job({ step: "filter", progress: 0.6 })));
    expect(screen.getByRole("progressbar", { name: "Porto build progress" })).toHaveAttribute(
      "aria-valuenow",
      "60"
    );
    expect(screen.getAllByText(/Filtering roads/).length).toBeGreaterThan(0);

    const before = calls.filter((c) => c.path === "/maps").length;
    act(() => wsHandlers.mapjob(job({ status: "done", progress: 1, mapId: "porto" })));
    expect(toast.success).toHaveBeenCalledWith("Built Porto");
    expect(screen.queryByRole("progressbar")).toBeNull();
    // The new map is fetched into the library.
    await waitFor(() => expect(calls.filter((c) => c.path === "/maps").length).toBe(before + 1));
  });

  it("shows why a build failed", async () => {
    server({ "GET /maps/jobs": { body: { jobs: [job()] } } });
    render(<Harness />);
    await screen.findByRole("progressbar", { name: "Porto build progress" });
    act(() => wsHandlers.mapjob(job({ status: "failed", error: "osmium exited with 1" })));
    expect(toast.error).toHaveBeenCalledWith("Building Porto failed: osmium exited with 1");
    expect(screen.getByText("osmium exited with 1")).toBeInTheDocument();
  });

  it("reports a build whose auto-switch failed as built, with a warning", async () => {
    server({ "GET /maps/jobs": { body: { jobs: [job({ activate: true })] } } });
    render(<Harness />);
    await screen.findByRole("progressbar", { name: "Porto build progress" });
    act(() =>
      wsHandlers.mapjob(
        job({ status: "done", progress: 1, mapId: "porto", error: "A map switch is in progress" })
      )
    );
    expect(toast.success).toHaveBeenCalledWith("Built Porto");
    expect(toast.info).toHaveBeenCalledWith(
      "Porto was built but not switched to: A map switch is in progress"
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("offers no cancel once the build is switching to the new map", async () => {
    server({ "GET /maps/jobs": { body: { jobs: [job({ step: "activate", progress: 0.95 })] } } });
    render(<Harness />);
    await screen.findByRole("progressbar", { name: "Porto build progress" });
    expect(screen.queryByRole("button", { name: "Cancel building Porto" })).toBeNull();
  });

  it("does not toast for builds that had already finished before the page loaded", async () => {
    server({ "GET /maps/jobs": { body: { jobs: [job({ status: "done", progress: 1 })] } } });
    render(<Harness />);
    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reads the job list again after the socket reconnects", async () => {
    let jobs = [job()];
    server({ "GET /maps/jobs": () => ({ body: { jobs } }) });
    render(<Harness />);
    await screen.findByRole("progressbar", { name: "Porto build progress" });

    // The build finished while the socket was down: its frame never arrived.
    jobs = [job({ status: "done", progress: 1, mapId: "porto" })];
    await act(async () => wsHandlers.connect({}));
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Built Porto");
  });

  it("keeps listing a build after the panel closes and reopens", async () => {
    server({ "GET /maps/jobs": { body: { jobs: [job()] } } });
    const { unmount } = render(<Harness />);
    await screen.findByRole("progressbar", { name: "Porto build progress" });
    unmount();
    render(<MapsPanel />);
    expect(screen.getByRole("progressbar", { name: "Porto build progress" })).toBeInTheDocument();
  });
});
