import type { POI, Road } from "@/types";
import { Directions, POI as POIIcon, Road as RoadIcon } from "@/components/Icons";
import { useRoads } from "@/hooks/useRoads";
import { usePois } from "@/hooks/usePois";
import { Typeahead } from "@/components/Inputs";
import styles from "./SearchBar.module.css";
import { isRoad } from "@/utils/typeGuards";
import { useCallback } from "react";

function Option({ item }: { item: Road | POI }) {
  const icon = isRoad(item) ? <RoadIcon /> : <POIIcon />;
  return (
    <div className={styles.option}>
      {icon}
      <span>{item.name}</span>
    </div>
  );
}

interface SearchBarProps {
  selectedItem: Road | POI | null;
  onDestinationClick: () => void;
  onItemSelect: (item: Road | POI) => void;
  onItemUnselect: () => void;
}

export default function SearchBar({
  selectedItem,
  onDestinationClick,
  onItemSelect,
}: SearchBarProps) {
  const { roads } = useRoads();
  const { pois } = usePois();
  const renderLabel = useCallback((item: Road | POI) => item.name || "not sure", []);
  const renderOption = (item: Road | POI) => <Option item={item} />;

  return (
    <div className={styles.searchBar}>
      <Typeahead
        className={styles.typeahead}
        options={[...roads, ...pois]}
        value={selectedItem}
        onChange={onItemSelect}
        // onOptionHover={onItemSelect}
        // onOptionLeave={onItemUnselect}
        renderLabel={renderLabel}
        renderOption={renderOption}
        placeholder="Search..."
      />

      <button
        type="button"
        onClick={onDestinationClick}
        disabled={!selectedItem}
        className={styles.destinationButton}
        aria-label="Get directions"
      >
        <Directions />
      </button>
    </div>
  );
}
