import React from "react";
import type { Road, Route, Heatzone, StartOptions, RoadNetwork, POI } from "@/types";
import { DEFAULT_START_OPTIONS } from "./constants";

export type DirectionMap = Map<string, Route>;

interface ClientData {
  options: StartOptions;
  roads: Road[];
  pois: POI[];
  directions: DirectionMap;
  heatzones: Heatzone[];
  network: RoadNetwork;
  setOptions: React.Dispatch<React.SetStateAction<StartOptions>>;
  setRoads: React.Dispatch<React.SetStateAction<Road[]>>;
  setPOIs: React.Dispatch<React.SetStateAction<POI[]>>;
  setDirections: React.Dispatch<React.SetStateAction<DirectionMap>>;
  setHeatzones: React.Dispatch<React.SetStateAction<Heatzone[]>>;
  setNetwork: React.Dispatch<React.SetStateAction<RoadNetwork>>;
}

export const ClientDataContext = React.createContext<ClientData>({
  options: DEFAULT_START_OPTIONS,
  roads: [],
  pois: [],
  directions: new Map(),
  heatzones: [],
  network: {
    type: "FeatureCollection",
    features: [],
  },
  setOptions: () => {},
  setRoads: () => {},
  setPOIs: () => {},
  setDirections: () => {},
  setHeatzones: () => {},
  setNetwork: () => {},
});
