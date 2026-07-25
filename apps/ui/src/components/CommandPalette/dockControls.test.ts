import { describe, it, expect, vi, afterEach } from "vitest";
import { closeDockPanel, openDockPanel } from "./dockControls";

/** Minimal stand-in for a `DockCluster` button. */
function mountDockButton(label: string, pressed: boolean) {
  const button = document.createElement("button");
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(pressed));
  const onClick = vi.fn();
  button.addEventListener("click", onClick);
  document.body.appendChild(button);
  return { button, onClick };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dockControls", () => {
  it("activates the dock button with the matching accessible name", () => {
    const monitor = mountDockButton("Monitor", false);
    const settings = mountDockButton("Settings", false);

    openDockPanel("Monitor");

    expect(monitor.onClick).toHaveBeenCalledTimes(1);
    expect(settings.onClick).not.toHaveBeenCalled();
  });

  it("is idempotent — does not toggle a panel that is already open", () => {
    const monitor = mountDockButton("Monitor", true);

    openDockPanel("Monitor");

    expect(monitor.onClick).not.toHaveBeenCalled();
  });

  it("ignores non-button elements carrying the same label", () => {
    const panel = document.createElement("div");
    panel.setAttribute("aria-label", "Monitor");
    document.body.appendChild(panel);
    const monitor = mountDockButton("Monitor", false);

    openDockPanel("Monitor");

    expect(monitor.onClick).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the dock is not mounted (e.g. during replay)", () => {
    expect(() => openDockPanel("Fleet & Dispatch")).not.toThrow();
    expect(() => closeDockPanel()).not.toThrow();
  });

  it("closes whichever panel is currently open", () => {
    const fleet = mountDockButton("Fleet & Dispatch", false);
    const settings = mountDockButton("Settings", true);

    closeDockPanel();

    expect(settings.onClick).toHaveBeenCalledTimes(1);
    expect(fleet.onClick).not.toHaveBeenCalled();
  });
});
