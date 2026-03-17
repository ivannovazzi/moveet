import React, { useMemo } from "react";
import type { Road, Heatzone, StartOptions, RoadNetwork, POI } from "../types";
import type { DirectionMap } from "./context";
import {
  RoadsContext,
  POIContext,
  DirectionContext,
  HeatZoneContext,
  NetworkContext,
  OptionsContext,
} from "./context";
import { DEFAULT_START_OPTIONS } from "./constants";

export default function DataProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<StartOptions>(DEFAULT_START_OPTIONS);
  const [roads, setRoads] = React.useState<Road[]>([]);
  const [pois, setPOIs] = React.useState<POI[]>([]);
  const [directions, setDirections] = React.useState<DirectionMap>(new Map());
  const [heatzones, setHeatzones] = React.useState<Heatzone[]>([]);
  const [network, setNetwork] = React.useState<RoadNetwork>({
    type: "FeatureCollection",
    features: [],
  });

  const optionsValue = useMemo(() => ({ options, setOptions }), [options]);
  const roadsValue = useMemo(() => ({ roads, setRoads }), [roads]);
  const poisValue = useMemo(() => ({ pois, setPOIs }), [pois]);
  const directionsValue = useMemo(() => ({ directions, setDirections }), [directions]);
  const heatzonesValue = useMemo(() => ({ heatzones, setHeatzones }), [heatzones]);
  const networkValue = useMemo(() => ({ network, setNetwork }), [network]);

  return (
    <OptionsContext.Provider value={optionsValue}>
      <RoadsContext.Provider value={roadsValue}>
        <POIContext.Provider value={poisValue}>
          <DirectionContext.Provider value={directionsValue}>
            <HeatZoneContext.Provider value={heatzonesValue}>
              <NetworkContext.Provider value={networkValue}>{children}</NetworkContext.Provider>
            </HeatZoneContext.Provider>
          </DirectionContext.Provider>
        </POIContext.Provider>
      </RoadsContext.Provider>
    </OptionsContext.Provider>
  );
}
