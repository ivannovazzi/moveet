import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import type { StatusTone } from "./DockPanelKit";

/**
 * The one derivation of adapter feed health, shared by everything that reports
 * it: the dock's FEED status lamp (`App`) and the Settings panel's status line
 * (`SettingsPanel`).
 *
 * There is no `FeedsSection` component any more. "Feeds & sinks" used to be a
 * Settings tab that opened its own Source/Sinks/Realism tab strip inside the
 * panel — section key → tab → inner tab, three levels of navigation inside a
 * 380px box. Those three are flat Settings tabs now (see `dockSections`), so
 * only the health derivation is left here, at the import path its two readers
 * already use.
 */

/** Coarse, user-facing health readout shared with the dock's FEED chip. */
export type FeedHealth = "Healthy" | "Needs attention" | "Unconfigured" | "Unreachable";

export const FEED_HEALTH_TONE: Record<FeedHealth, StatusTone> = {
  Healthy: "ok",
  "Needs attention": "warn",
  Unconfigured: "idle",
  Unreachable: "idle",
};

export function feedHealth(health: ReturnType<typeof useAdapterConfig>["health"]): FeedHealth {
  if (!health) return "Unreachable";
  if (!health.source && health.sinks.length === 0) return "Unconfigured";
  const ok = health.source?.healthy !== false && health.sinks.every((sink) => sink.healthy);
  return ok ? "Healthy" : "Needs attention";
}
