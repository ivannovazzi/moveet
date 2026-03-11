import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "@/utils/client";
import ControlPanel from "./Controls/Controls";
import Vehicles from "./Controls/Vehicles";
import Fleets from "./Controls/Fleets";
import AdapterDrawer from "./Controls/Adapter/AdapterDrawer";
import { useAdapterConfig } from "./Controls/Adapter/useAdapterConfig";
import MapView from "./Map/Map";
import FleetLegend from "./Map/FleetLegend";
import SearchBar from "./SearchBar";
import Zoom from "./Zoom/";
import type { Fleet, Modifiers, POI, Position, Road, SimulationStatus } from "./types";
import styles from "./App.module.css";
import { useVehicles } from "./hooks/useVehicles";
import { useFleets } from "./hooks/useFleets";
import useContextMenu from "./hooks/useContextMenu";
import ContextMenu from "./components/ContextMenu";
import { Button } from "./components/Inputs";
import { isRoad } from "./utils/typeGuards";

export default function App() {
  const [onContextClick, ref, xy, closeContextMenu] = useContextMenu();
  const [selectedItem, setSelectedItem] = useState<Road | POI | null>(null);
  const [destination, setDestination] = useState<Position | null>(null);
  const [isVehiclePanelOpen, setVehiclePanelOpen] = useState(false);
  const [isAdapterPanelOpen, setAdapterPanelOpen] = useState(false);
  const [status, setStatus] = useState<SimulationStatus>({
    interval: 0,
    running: false,
    ready: false,
  });

  const [connected, setConnected] = useState(false);
  const adapter = useAdapterConfig(isAdapterPanelOpen);
  const {
    vehicles,
    modifiers,
    filters,
    setVehicles,
    onSelectVehicle,
    onUnselectVehicle,
    onHoverVehicle,
    onUnhoverVehicle,
    setModifiers,
    onFilterChange,
  } = useVehicles();

  const { fleets, createFleet, deleteFleet, assignVehicle, unassignVehicle, hiddenFleetIds, toggleFleetVisibility } = useFleets();

  const vehicleFleetMap = useMemo(() => {
    const map = new Map<string, Fleet>();
    for (const fleet of fleets) {
      for (const vid of fleet.vehicleIds) {
        map.set(vid, fleet);
      }
    }
    return map;
  }, [fleets]);

  const onChangeModifiers = useCallback(
    <T extends keyof Modifiers>(name: T) =>
      (value: Modifiers[T]) => {
        setModifiers((prev) => ({
          ...prev,
          [name]: value,
        }));
      },
    [setModifiers]
  );

  const clearMap = useCallback(() => {
    closeContextMenu();
    setDestination(null);
    onUnselectVehicle();
    setSelectedItem(null);
  }, [closeContextMenu, onUnselectVehicle]);

  const onMapClick = useCallback(() => {
    clearMap();
  }, [clearMap]);

  const setFinalDestination = useCallback(async (position: Position, vehicleIds: string[]) => {
    const coordinates = await client.findNode(position);
    if (!coordinates.data) return;
    await client.direction(vehicleIds, coordinates.data);
  }, []);

  const onDestinationClick = useCallback(async () => {
    let coordinates: Position;
    if (!selectedItem) return;
    if (isRoad(selectedItem)) {
      const getOne = (arr: Position[]) => arr[Math.floor(Math.random() * arr.length)];
      coordinates = getOne(selectedItem.streets.flat());
    } else {
      coordinates = [selectedItem.coordinates[1], selectedItem.coordinates[0]];
    }
    await setFinalDestination(
      coordinates,
      vehicles.map((v) => v.id)
    );
    clearMap();
  }, [selectedItem, vehicles, setFinalDestination, clearMap]);

  const onPointDestinationClick = useCallback(async () => {
    await setFinalDestination(
      destination!,
      vehicles.map((v) => v.id)
    );
    clearMap();
  }, [destination, vehicles, setFinalDestination, clearMap]);

  const onPointDestinationSingleClick = useCallback(async () => {
    await setFinalDestination(destination!, [filters.selected!]);
    clearMap();
  }, [destination, filters.selected, setFinalDestination, clearMap]);

  const onFindRoadClick = useCallback(async () => {
    const road = await client.findRoad(destination!);
    if (road.data) setSelectedItem(road.data);
    closeContextMenu();
  }, [destination, closeContextMenu]);

  const onMapContextClick = useCallback(
    (e: React.MouseEvent, position: Position) => {
      setDestination(position);
      onContextClick(e);
    },
    [onContextClick]
  );

  useEffect(() => {
    client.getVehicles().then((response) => {
      if (response.error) {
        console.error("Failed to fetch vehicles:", response.error);
        return;
      }
      if (response.data) {
        setVehicles(response.data);
      }
    });
  }, [setVehicles]);

  useEffect(() => {
    client.onConnect(() => {
      setConnected(true);
      // Re-fetch full state on reconnect
      client.getVehicles().then((response) => {
        if (response.data) setVehicles(response.data);
      });
    });
    client.onDisconnect(() => setConnected(false));
    client.onStatus((data) => {
      setStatus(data);
    });
    client.onReset((data) => {
      setVehicles(data.vehicles);
      setSelectedItem(null);
      setDestination(null);
      onUnselectVehicle();
    });
    client.getStatus().then((response) => {
      if (response.data) {
        setStatus(response.data);
      }
    });

    client.connectWebSocket();
    return () => client.disconnect();
  }, [setVehicles, onUnselectVehicle]);

  const maxSpeedRef = useRef(60);

  return (
    <div className={styles.app}>
      <div className={styles.controls}>
        <ControlPanel
          status={status}
          vehicles={vehicles}
          connected={connected}
          modifiers={modifiers}
          filters={filters}
          onChangeModifiers={onChangeModifiers}
          maxSpeedRef={maxSpeedRef}
          isVehiclePanelOpen={isVehiclePanelOpen}
          onToggleVehiclePanel={() => setVehiclePanelOpen((open) => !open)}
          isAdapterPanelOpen={isAdapterPanelOpen}
          onToggleAdapterPanel={() => setAdapterPanelOpen((open) => !open)}
          adapterStatus={adapter.status}
        />
      </div>

      <div className={styles.content}>
        <aside
          className={classNames(styles.panelRail, styles.leftPanel, {
            [styles.leftPanelOpen]: isVehiclePanelOpen,
          })}
          aria-hidden={!isVehiclePanelOpen}
        >
          <div className={styles.panelInner}>
            <Fleets fleets={fleets} onCreateFleet={createFleet} onDeleteFleet={deleteFleet} />
            <Vehicles
              filter={filters.filter}
              onFilterChange={onFilterChange}
              vehicles={vehicles}
              onSelectVehicle={onSelectVehicle}
              onHoverVehicle={onHoverVehicle}
              onUnhoverVehicle={onUnhoverVehicle}
              maxSpeed={maxSpeedRef.current}
              fleets={fleets}
              onAssignVehicle={assignVehicle}
              onUnassignVehicle={unassignVehicle}
            />
          </div>
        </aside>
        <div className={styles.map}>
          {!connected && (
            <div className={styles.disconnectedBanner} role="alert">
              Disconnected — attempting to reconnect...
            </div>
          )}
          <MapView
            animFreq={status.interval}
            vehicles={vehicles}
            filters={filters}
            modifiers={modifiers}
            selectedItem={selectedItem}
            onClick={onSelectVehicle}
            onMapClick={onMapClick}
            onMapContextClick={onMapContextClick}
            onPOIClick={(poi) => setSelectedItem(poi)}
            vehicleFleetMap={vehicleFleetMap}
            hiddenFleetIds={hiddenFleetIds}
          />
          <SearchBar
            selectedItem={selectedItem}
            onDestinationClick={onDestinationClick}
            onItemSelect={(item) => setSelectedItem(item)}
            onItemUnselect={() => setSelectedItem(null)}
          />
          <Zoom />
          <FleetLegend fleets={fleets} hiddenFleetIds={hiddenFleetIds} onToggle={toggleFleetVisibility} />
        </div>
        <aside
          className={classNames(styles.panelRail, styles.rightPanel, {
            [styles.rightPanelOpen]: isAdapterPanelOpen,
          })}
          aria-hidden={!isAdapterPanelOpen}
        >
          <div className={styles.panelInner}>
            <AdapterDrawer
              isOpen={isAdapterPanelOpen}
              health={adapter.health}
              config={adapter.config}
              loading={adapter.loading}
              error={adapter.error}
              onClose={() => setAdapterPanelOpen(false)}
              onSetSource={adapter.setSource}
              onAddSink={adapter.addSink}
              onRemoveSink={adapter.removeSink}
            />
          </div>
        </aside>
      </div>
      {xy && (
        <ContextMenu position={xy}>
          <div ref={ref} className={styles.contextMenu}>
            <Button onClick={onPointDestinationClick}>Find Directions To Here</Button>
            <Button onClick={onFindRoadClick}>Identify closest road</Button>
            {filters.selected && (
              <Button onClick={onPointDestinationSingleClick}>Send selected vehicle here</Button>
            )}
          </div>
        </ContextMenu>
      )}
    </div>
  );
}
