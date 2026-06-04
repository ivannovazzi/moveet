import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  visible: boolean;
}

export default function LoadingOverlay({ visible }: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 grid place-items-center gap-4 bg-background/70 backdrop-blur transition-opacity duration-500 pointer-events-none",
        !visible && "invisible opacity-0"
      )}
      role="status"
      aria-label="Loading map data"
      aria-hidden={!visible}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 animate-spin rounded-full border-[3px] border-border border-t-accent" />
        <span className="text-sm tracking-wide text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}
