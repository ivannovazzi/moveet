import { countMisbehavingDevices } from "@/lib/faultPresets";
import { DispatchState } from "@/hooks/useDispatchState";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { DockBadges } from "./dockSections";
import type { UseFaults } from "@/hooks/useFaults";

/**
 * The live counts pinned to the dock's keys and the console's tabs.
 *
 * Both surfaces show the same numbers — a rolled-up count on a collapsed
 * section key, the precise one on the tab that owns it — so they are built once
 * by whoever owns the data rather than twice from two copies of the rules. The
 * counts ride on buttons that are always there; nothing here adds or removes a
 * key, so the shape of a section never depends on live data.
 */
export interface DockBadgeInput {
  dispatch: DispatchFlow;
  breachedJobs: number;
  openIncidents: number;
  faults: UseFaults;
  isRecording: boolean;
}

export function buildDockBadges({
  dispatch,
  breachedJobs,
  openIncidents,
  faults,
  isRecording,
}: DockBadgeInput): DockBadges {
  const dispatchCount =
    dispatch.dispatchState !== DispatchState.BROWSE ? dispatch.selectedForDispatch.length : 0;
  const faultyDevices = countMisbehavingDevices(faults.config, faults.status);

  return {
    dispatch:
      dispatchCount > 0
        ? {
            count: dispatchCount,
            tone: "accent",
            label: `${dispatchCount} vehicles selected for dispatch`,
          }
        : undefined,
    jobs:
      breachedJobs > 0
        ? { count: breachedJobs, tone: "error", label: `${breachedJobs} jobs past SLA` }
        : undefined,
    incidents:
      openIncidents > 0
        ? { count: openIncidents, tone: "error", label: `${openIncidents} open incidents` }
        : undefined,
    faults:
      faultyDevices > 0
        ? { count: faultyDevices, tone: "error", label: `${faultyDevices} misbehaving devices` }
        : undefined,
    recordings: isRecording
      ? { count: 1, tone: "error", label: "Recording in progress" }
      : undefined,
  };
}
