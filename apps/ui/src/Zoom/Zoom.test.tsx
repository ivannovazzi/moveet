import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RoadNetwork } from "@/types";
import { NetworkContext } from "@/data/context";
import { setMapControlsRef, controlsRef } from "@/components/Map/providers/controls";
import { canFitNetwork, fitNetwork, setFitNetwork } from "./fitNetwork";
import Zoom from "./index";

const EMPTY: RoadNetwork = { type: "FeatureCollection", features: [] };

const NETWORK: RoadNetwork = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [36.8, -1.3],
          [36.9, -1.2],
        ],
      },
      properties: {},
    },
  ],
};

const controls = {
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  panTo: vi.fn(),
  setZoom: vi.fn(),
  getZoom: vi.fn(() => 12),
  setBounds: vi.fn(),
  focusOn: vi.fn(),
};

const previousControls = controlsRef;

function renderCluster(network: RoadNetwork = NETWORK) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NetworkContext.Provider value={{ network, setNetwork: vi.fn() }}>
      {children}
    </NetworkContext.Provider>
  );
  return render(<Zoom />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  setMapControlsRef(controls);
});

afterEach(() => {
  setMapControlsRef(previousControls);
  setFitNetwork(null);
});

const key = (name: string) => screen.getByRole("button", { name });

describe("Zoom (map controls cluster)", () => {
  it("is one cluster of three keys: fit, in, out", () => {
    renderCluster();

    const cluster = screen.getByRole("group", { name: "Map controls" });
    const names = Array.from(cluster.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label")
    );

    expect(names).toEqual(["Fit network", "Zoom in", "Zoom out"]);
  });

  it("stands on the dock shelf beside the visibility rail", () => {
    renderCluster();

    const cluster = screen.getByRole("group", { name: "Map controls" });
    expect(cluster.className).toContain("bottom-above-dock");
    expect(cluster.className).toContain("left-beside-rail");
  });

  it("carries each key's shortcut in its tooltip", () => {
    renderCluster();

    expect(key("Fit network")).toHaveAttribute("title", "Fit network (0)");
    expect(key("Zoom in")).toHaveAttribute("title", "Zoom in (+)");
    expect(key("Zoom out")).toHaveAttribute("title", "Zoom out (−)");
  });

  it("steps the camera through the map controls", () => {
    renderCluster();

    fireEvent.click(key("Zoom in"));
    fireEvent.click(key("Zoom out"));

    expect(controls.zoomIn).toHaveBeenCalledOnce();
    expect(controls.zoomOut).toHaveBeenCalledOnce();
  });

  it("fits the camera to the whole network's bounds", () => {
    renderCluster();

    fireEvent.click(key("Fit network"));

    expect(controls.setBounds).toHaveBeenCalledWith([
      [36.8, -1.3],
      [36.9, -1.2],
    ]);
  });

  it("disables the fit key while the network is still loading", () => {
    renderCluster(EMPTY);

    expect(key("Fit network")).toBeDisabled();
    fireEvent.click(key("Fit network"));
    expect(controls.setBounds).not.toHaveBeenCalled();
  });

  it("publishes the fit action for the keyboard and the palette", () => {
    const { unmount } = renderCluster();

    expect(canFitNetwork()).toBe(true);
    fitNetwork();
    expect(controls.setBounds).toHaveBeenCalledOnce();

    // Withdrawn on unmount, so a stale closure can't move a map that is gone.
    unmount();
    expect(canFitNetwork()).toBe(false);
    fitNetwork();
    expect(controls.setBounds).toHaveBeenCalledOnce();
  });

  it("publishes nothing while there is no network to fit", () => {
    renderCluster(EMPTY);

    expect(canFitNetwork()).toBe(false);
  });
});
