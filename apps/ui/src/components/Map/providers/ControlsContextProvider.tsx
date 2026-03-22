import { setMapControlsRef } from "./controls";
import type { MapControlsContextValue, DeckViewStateControls } from "./types";
import { MapControlsContext } from "./contexts";

interface DeckControlsProps {
  controls: DeckViewStateControls;
  children: React.ReactNode;
}

export function DeckControlsProvider({ controls, children }: DeckControlsProps) {
  const value: MapControlsContextValue = controls;

  setMapControlsRef(value);

  return <MapControlsContext.Provider value={value}>{children}</MapControlsContext.Provider>;
}
