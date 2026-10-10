import { lazy, Suspense } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { MapLibrary } from "./mapsClient";
import NewMapForm from "./NewMapForm";

/** deck.gl and the picker's layers load only when the dialog opens. */
const PickerMap = lazy(() => import("./picker/PickerMap"));

/** The world map needs WebGL2; without it (or under jsdom) the form still works on its own. */
function canDrawMap(): boolean {
  return typeof window !== "undefined" && typeof window.WebGL2RenderingContext !== "undefined";
}

/**
 * The New map flow as a large dialog: the area picker's world map on one side,
 * the search on the other. The world map is the picker's own view, separate
 * from the simulation map, so the operator can look anywhere in the world
 * without moving the simulation's camera.
 */
export default function NewMapDialog({
  library,
  onClose,
}: {
  library: MapLibrary | null;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1440px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1440px] md:flex-row"
        // A stray click beside the dialog must not throw away the area.
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">New map</DialogTitle>
        <DialogDescription className="sr-only">
          Search a place, check its area on the world map, then build it.
        </DialogDescription>
        <div className="relative min-h-[45dvh] flex-1 md:min-h-0">
          {canDrawMap() ? (
            <Suspense
              fallback={
                <p className="p-4 text-micro text-muted-foreground">Loading the world map…</p>
              }
            >
              <PickerMap
                library={library}
                maxAreaKm2={library?.builds?.limits.maxAreaKm2 ?? null}
              />
            </Suspense>
          ) : (
            <p className="p-4 text-micro text-muted-foreground">
              This browser cannot draw the world map (no WebGL2). The search still works.
            </p>
          )}
        </div>
        <div className="max-h-[55dvh] w-full shrink-0 overflow-y-auto border-border border-t md:max-h-none md:w-[360px] md:border-t-0 md:border-l">
          <NewMapForm library={library} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
