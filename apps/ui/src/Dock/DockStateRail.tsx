import { cn } from "@/lib/utils";
import { toneFillClass, type StatusTone } from "./DockPanelKit";

export interface DockStateRailProps {
  /** Tone of the active map mode, or null when browsing. */
  tone: StatusTone | null;
  recording: boolean;
  /** Replay position 0..1, or null when not replaying. */
  replayProgress: number | null;
}

/**
 * The dock's bottom hairline, doubling as the session's state read-out: a
 * playhead while a recording replays, a slow red pulse while one is being
 * captured, a tone line while a map mode is active, and nothing at all when
 * the dock is just a dock. One device, no extra chrome.
 */
export default function DockStateRail({ tone, recording, replayProgress }: DockStateRailProps) {
  if (replayProgress !== null) {
    return (
      <Rail>
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(Math.max(replayProgress, 0), 1) * 100}%` }}
        />
      </Rail>
    );
  }

  if (recording) {
    return (
      <Rail>
        <span className="block h-full w-full rounded-full bg-status-error/70 motion-safe:animate-pulse" />
      </Rail>
    );
  }

  if (tone) {
    return (
      <Rail>
        <span className={cn("block h-full w-full rounded-full opacity-60", toneFillClass(tone))} />
      </Rail>
    );
  }

  return null;
}

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-3 bottom-[3px] h-[2px] overflow-hidden rounded-full"
    >
      {children}
    </div>
  );
}
