/**
 * Bridge from the command palette to the dock's panel navigation.
 *
 * The dock owns which panel is open entirely internally (`useDockNavigation`
 * is called inside `Dock.tsx` and never lifted), so there is no handler the
 * palette can call. Rather than standing up a *second* copy of that state —
 * which would immediately drift out of sync with the dock's own buttons — the
 * palette activates the dock's existing accessible controls, looked up by
 * accessible name. That is exactly what a keyboard user pressing Enter on the
 * dock button does, so there is still one source of truth.
 *
 * Each dock cluster button is a `<button aria-label=… aria-pressed=…>` (see
 * `Dock/DockCluster.tsx`), so `aria-pressed` also tells us whether the panel
 * is already open — "open X" is idempotent and "close panel" can find the
 * open one. If the dock is unmounted (e.g. `ReplayDock` has taken over) the
 * lookup misses and the call is a no-op.
 */

/** Accessible names of the dock's panel-owning cluster buttons. */
export const DOCK_PANEL_LABELS = [
  "Fleet & Dispatch",
  "Sinks & Source",
  "Monitor",
  "Settings",
  "Tempo details",
] as const;

export type DockPanelLabel = (typeof DOCK_PANEL_LABELS)[number];

function dockButton(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    // Scoped to `button` because `DockPanel` mirrors the same label onto the
    // open panel's container element.
    `button[aria-label="${label}"]`
  );
}

/** Open the dock panel with this accessible name. No-op when already open. */
export function openDockPanel(label: DockPanelLabel): void {
  const button = dockButton(label);
  if (!button) return;
  if (button.getAttribute("aria-pressed") === "true") return;
  button.click();
}

/** Close whichever dock panel is currently open. No-op when none is. */
export function closeDockPanel(): void {
  for (const label of DOCK_PANEL_LABELS) {
    const button = dockButton(label);
    if (button?.getAttribute("aria-pressed") === "true") {
      button.click();
      return;
    }
  }
}
