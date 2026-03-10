import React, { useMemo } from "react";
import type { Road, Heatzone, StartOptions, RoadNetwork, POI } from "../types";
import type { DirectionMap } from "./context";
import { ClientDataContext } from "./context";
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

  const value = useMemo(
    () => ({
      options,
      roads,
      pois,
      directions,
      heatzones,
      network,
      setOptions,
      setPOIs,
      setRoads,
      setDirections,
      setHeatzones,
      setNetwork,
    }),
    [options, roads, pois, directions, heatzones, network]
  );

  return <ClientDataContext.Provider value={value}>{children}</ClientDataContext.Provider>;
}
