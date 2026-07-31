import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Toasts, dressed as part of the dock's instrument family.
 *
 * They come in **top centre**, under the search field — the one place on the map
 * that is never busy and where the eye already goes. Bottom-right put them in the
 * corner furthest from anything the operator was looking at, on top of the fleet
 * legend, and in the same band as the dock, so a toast and the dock's own state
 * hairline competed for the same glance.
 *
 * `unstyled` turns off sonner's padding/background/border defaults (they are all
 * gated on `[data-styled=true]`) while keeping its stacking and animation, so the
 * card below is the same material as every other floating surface: one glass, one
 * blur, one edge. The type shows up as a coloured glyph and a whisper of tone
 * wash — never as a saturated block of colour.
 */

/** Clears the search field (bottom edge ~65px) with room to breathe. */
const TOP_OFFSET = 78;

const CARD = cn(
  "group pointer-events-auto relative flex w-full items-start gap-2.5 overflow-hidden",
  "rounded-[12px] border border-border px-3 py-2.5",
  "surface-glass glass-frost",
  // Elevation plus the machined edge, the same one the dock bars carry.
  "shadow-[0_20px_45px_-14px_oklch(0_0_0/0.7),inset_0_1px_0_oklch(1_0_0/0.07),inset_0_-1px_0_oklch(0_0_0/0.35)]",
  // Tone wash. It has to be a pseudo-element: `surface-glass` paints a gradient
  // *image*, so a background-colour tint would sit underneath it and never show.
  "before:pointer-events-none before:absolute before:inset-0 before:content-['']",
  "data-[type=success]:before:bg-status-ok/[0.09]",
  "data-[type=error]:before:bg-status-error/[0.11]",
  "data-[type=warning]:before:bg-status-warn/[0.10]",
  "data-[type=info]:before:bg-accent/[0.08]",
  // The glyph carries the type at a glance; the text stays plain foreground.
  "[&_[data-icon]]:mt-px [&_[data-icon]]:shrink-0 [&_[data-icon]]:text-muted-foreground",
  "data-[type=success]:[&_[data-icon]]:text-status-ok",
  "data-[type=error]:[&_[data-icon]]:text-status-error",
  "data-[type=warning]:[&_[data-icon]]:text-status-warn",
  "data-[type=info]:[&_[data-icon]]:text-accent",
  "[&_[data-icon]>svg]:size-[15px]"
);

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      offset={{ top: TOP_OFFSET }}
      mobileOffset={{ top: 12, left: 12, right: 12 }}
      gap={8}
      // Laid out as a column rather than sonner's collapsed deck: the cards are
      // glass and each is as tall as its own message, so a stack of them peeked
      // out from behind the front one in slivers of half-clipped text.
      expand
      // Three is a stack you can still read at a glance; more is a log, and the
      // session timeline is where a log belongs.
      visibleToasts={3}
      closeButton
      icons={{
        success: <CircleCheckIcon />,
        info: <InfoIcon />,
        warning: <TriangleAlertIcon />,
        error: <OctagonXIcon />,
        loading: <Loader2Icon className="animate-spin" />,
      }}
      style={{ "--width": "384px" } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: CARD,
          content: "relative flex min-w-0 flex-1 flex-col gap-0.5",
          title: "text-[12.5px] font-medium leading-[1.35] text-foreground",
          description: "text-[11.5px] leading-[1.4] text-muted-foreground",
          actionButton: cn(
            "relative ml-1 shrink-0 self-center rounded-md bg-accent px-2.5 py-1",
            "text-[11.5px] font-medium text-primary-foreground shadow-raised",
            "transition-[filter] duration-fast ease-standard hover:brightness-110",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          ),
          cancelButton: cn(
            "relative ml-1 shrink-0 self-center rounded-md border border-border bg-foreground/[0.04] px-2.5 py-1",
            "text-[11.5px] font-medium text-muted-foreground",
            "transition-colors duration-fast ease-standard hover:bg-foreground/[0.08] hover:text-foreground"
          ),
          // A flex child at the end, not sonner's floating corner button: with an
          // action key already on the right, a corner ✕ landed on top of it. It
          // stays quiet rather than hiding until hover, so nothing shifts under
          // the cursor and a toast held open (the reload prompt) always shows its
          // way out.
          // `bg-transparent!` / `text-…!`: sonner paints the close button through
          // `[data-sonner-toast] [data-close-button]`, which outranks a plain
          // utility class, so it came through as a solid black chip on the glass.
          closeButton: cn(
            "relative order-last flex size-5 shrink-0 items-center justify-center self-center rounded-md",
            "border-0! bg-transparent! text-muted-foreground/50!",
            "transition-colors duration-fast ease-standard",
            "hover:bg-foreground/[0.08]! hover:text-foreground!",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "[&>svg]:size-3"
          ),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
