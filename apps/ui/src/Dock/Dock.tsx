import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { ReplayStatus, SimulationStatus, StartOptions } from "@/types";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import type { ModeGuard } from "@/hooks/useModeGuard";
import { useClock } from "@/hooks/useClock";
import AnchoredPanel from "./AnchoredPanel";
import DockSurface from "./DockSurface";
import DockDeck, { dockActivity } from "./DockDeck";
import TempoPanel from "./TempoPanel";
import SectionRail from "./SectionRail";
import { PanelHeaderRow } from "./DockPanelKit";
import type { DockBadges } from "./dockSections";
import type { ModeDescriptor } from "./modeDescriptors";

/**
 * The dock row: three columns pinned across the viewport, bottom aligned.
 *
 * `1fr auto 1fr` puts the deck's centre exactly on the viewport's centre line —
 * permanently, whatever else is on the row — and gives the sections wing its own
 * half, in which it sits hard against the viewport's right edge. The wing can
 * never push the deck, the deck can never move the wing, and neither can grow
 * past its half: the deck's surface clips its contents instead of running off
 * screen. The grid itself is
 * click-through; only the surfaces take pointer events (see `DockSurface`), so
 * the empty map either side of the docks still pans.
 */
const ROW_CLASS = cn(
  // The shell grid's bottom row (see `ShellGrid`) gives it the 12px outer
  // margin and, more to the point, reserves its height — so everything in the
  // row above clears the dock without being told how tall it is.
  "pointer-events-none relative grid items-end gap-2",
  "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
  "translate-y-3.5 opacity-0 transition-[opacity,translate] duration-700 ease-emphasized",
  "[[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

export interface DockProps {
  /**
   * Which section is expanded into its own dock and which of its buttons is
   * lit. Owned by `App.tsx` so the command palette drives the very same state
   * and the keyboard dispatcher can collapse the row on Escape.
   */
  navigation: DockNavigation;

  connected: boolean;
  status: SimulationStatus;
  options: StartOptions;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  /**
   * The active map mode as words, tone and actions (null while browsing), plus
   * the guard that holds a mode switch when the current one is carrying work.
   */
  modeDescriptor: ModeDescriptor | null;
  guard: ModeGuard;
  onStartMode: (kind: InteractionModeKind) => void;

  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;

  /**
   * Live counts for the section keys. Built by App (see `dockBadges`) so the
   * dock's rolled-up counts and the console's per-tab ones can never be two
   * different readings of the same data.
   */
  badges: DockBadges;

  className?: string;
}

/**
 * The dock row: two docks, and one rule that holds them apart.
 *
 *   deck     — the centre, on the viewport's centre line. Its contents are the
 *              current activity's keys and nothing else: watching the run, in a
 *              mode, replaying, or being asked to discard (see `DockDeck`). It is
 *              as wide as that key set needs and no wider.
 *   sections — right wing: Fleet / Monitor / Session / Settings keys; selecting
 *              one lights that key and opens its panel above. Pinned to the
 *              viewport's right edge, so no deck activity ever moves it.
 *
 * Health lamps are not here at all — they live in the top-right corner, where
 * nothing is pressed.
 *
 * Owns the shared `useClock` so the tempo readout and its panel cannot disagree.
 * Adapter state arrives from App, which shares it with the corner health lamps.
 */
export default function Dock({
  navigation,
  connected,
  status,
  options,
  isRecording,
  onStartRecording,
  onStopRecording,
  modeDescriptor,
  guard,
  onStartMode,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
  badges,
  className,
}: DockProps) {
  const { tempoOpen, toggleTempo, close } = navigation;
  const { launcherOpen, setLauncherOpen } = navigation;
  const { clock, setSpeedMultiplier } = useClock();

  // The deck is the tempo panel's positioning origin.
  const mainRef = useRef<HTMLDivElement>(null);
  const tempoBtnRef = useRef<HTMLButtonElement>(null);

  // Exposed on the surface as `data-activity` so what the dock is currently for
  // is inspectable from the DOM (and assertable in tests) without reading classes.
  const deckActivity = dockActivity({
    pendingDiscard: guard.pending !== null,
    replaying: replayStatus.mode === "replay",
    inMode: modeDescriptor !== null,
  });

  return (
    <div className={cn(ROW_CLASS, className)}>
      {/* The left column is deliberately empty: it is what keeps the deck's
          centre on the viewport's centre line while the right wing grows. */}
      <div aria-hidden />

      {/* The tempo panel is a sibling of the bar rather than a child: a blurred
          ancestor is a backdrop root, and a panel inside one has nothing to
          frost (see `AnchoredPanel`). */}
      <div className="relative flex min-w-0">
        <DockSurface
          ref={mainRef}
          data-dock="deck"
          data-activity={deckActivity}
          // Sized to the key set it is holding, and centred, so the bar is
          // exactly as wide as the work at hand: two keys while drawing a heat
          // zone, the run's five while watching it. What stays put is the dock's
          // centre — the eye finds it in the same place in every activity.
          className="relative items-center overflow-hidden"
        >
          <DockDeck
            connected={connected}
            running={status.running}
            options={options}
            isRecording={isRecording}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            launcherOpen={launcherOpen}
            onLauncherOpenChange={setLauncherOpen}
            clock={clock}
            tempoOpen={tempoOpen}
            onToggleTempo={toggleTempo}
            tempoButtonRef={tempoBtnRef}
            modeDescriptor={modeDescriptor}
            guard={guard}
            onStartMode={onStartMode}
            replayStatus={replayStatus}
            onPauseReplay={onPauseReplay}
            onResumeReplay={onResumeReplay}
            onStopReplay={onStopReplay}
            onSeekReplay={onSeekReplay}
            onSetReplaySpeed={onSetReplaySpeed}
          />
        </DockSurface>

        <AnchoredPanel
          open={tempoOpen}
          id="dock-tempo-panel"
          aria-label="Tempo"
          header={<PanelHeaderRow title="Tempo" onClose={close} closeLabel="Close Tempo" />}
          anchorRef={tempoBtnRef}
          originRef={mainRef}
          width="w-[340px]"
          positionKey="tempo"
          onClose={close}
        >
          <TempoPanel clock={clock} onSetMultiplier={setSpeedMultiplier} />
        </AnchoredPanel>
      </div>

      {/* Right wing, pinned to the viewport's right edge (the row is inset by
          8px either side). It is deliberately NOT packed against the deck: a
          wing that starts where the deck ends slides left and right by 100px
          every time the deck changes activity — dispatch's rail is wider than
          the live run's keys, the guard prompt is wider again — and the four
          section keys are exactly the targets that must never move. The deck
          keeps the centre line; the wing keeps the right edge; neither can
          push the other. */}
      <div data-dock-wing="sections" className="flex min-w-0 justify-end">
        <SectionRail navigation={navigation} badges={badges} />
      </div>
    </div>
  );
}
