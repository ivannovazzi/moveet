/**
 * The one place map legends live.
 *
 * Each overlay used to position its own legend absolutely, which meant every
 * new overlay had to know about every other one's coordinates — and got it
 * wrong: with Density and Traffic both lit, the traffic legend landed on top
 * of the vertically-centred visibility rail at a 1000px window.
 *
 * So legends no longer place themselves. They render into this column, which
 * owns the top-left slot under the search bar and grows *down*. The visibility
 * rail is anchored to the bottom-left and grows *up* (see `VisibilityRail`),
 * and the stack's `max-height` reserves that band, so the two can never meet
 * however many overlays are on.
 *
 * Overlay components must stay children of `DeckGLMap` (that is where they
 * register their deck.gl layers), so they can't be moved into this subtree.
 * They portal their legend here instead, via `renderInSlot`.
 */
import type { ReactNode, Ref, RefObject } from "react";
import { createPortal } from "react-dom";

/** The stack element an overlay portals its legend into, once mounted. */
export type LegendSlot = RefObject<HTMLElement | null>;

/**
 * Portal `legend` into the stack, or render it where it stands when there is
 * no stack (unit tests, and the first paint before the ref is attached).
 * A plain function, not a hook — it is called from JSX.
 */
export function renderInSlot(slot: LegendSlot | undefined, legend: ReactNode): ReactNode {
  const host = slot?.current;
  return host ? createPortal(legend, host) : legend;
}

interface LegendStackProps {
  children?: ReactNode;
  /** React 19 ref-as-prop — Map hands this to the overlays as their slot. */
  ref?: Ref<HTMLDivElement>;
}

export default function LegendStack({ children, ref }: LegendStackProps) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Map legends"
      className="pointer-events-none absolute left-3 top-[72px] z-10 flex w-[164px] flex-col gap-2 max-h-[calc(100vh-72px-var(--spacing-above-dock)-var(--legend-stack-clearance))] overflow-hidden"
    >
      {children}
    </div>
  );
}
