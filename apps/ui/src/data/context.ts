import React from "react";
import type { Road, Heatzone, StartOptions, RoadNetwork, POI } from "@/types";
import type { DirectionState } from "@/hooks/useDirections";
import { DEFAULT_START_OPTIONS } from "./constants";

export type DirectionMap = Map<string, DirectionState>;

// ─── Roads Context ──────────────────────────────────────────────────
export interface RoadsContextValue {
  roads: Road[];
  setRoads: React.Dispatch<React.SetStateAction<Road[]>>;
}

export const RoadsContext = React.createContext<RoadsContextValue>({
  roads: [],
  setRoads: () => {},
});

// ─── POI Context ────────────────────────────────────────────────────
export interface POIContextValue {
  pois: POI[];
  setPOIs: React.Dispatch<React.SetStateAction<POI[]>>;
}

export const POIContext = React.createContext<POIContextValue>({
  pois: [],
  setPOIs: () => {},
});

// ─── Direction Context ──────────────────────────────────────────────
export interface DirectionContextValue {
  directions: DirectionMap;
  setDirections: React.Dispatch<React.SetStateAction<DirectionMap>>;
}

export const DirectionContext = React.createContext<DirectionContextValue>({
  directions: new Map(),
  setDirections: () => {},
});

// ─── HeatZone Context ──────────────────────────────────────────────
export interface HeatZoneContextValue {
  heatzones: Heatzone[];
  setHeatzones: React.Dispatch<React.SetStateAction<Heatzone[]>>;
}

export const HeatZoneContext = React.createContext<HeatZoneContextValue>({
  heatzones: [],
  setHeatzones: () => {},
});

// ─── Network Context ────────────────────────────────────────────────
export interface NetworkContextValue {
  network: RoadNetwork;
  setNetwork: React.Dispatch<React.SetStateAction<RoadNetwork>>;
}

export const NetworkContext = React.createContext<NetworkContextValue>({
  network: { type: "FeatureCollection", features: [] },
  setNetwork: () => {},
});

// ─── Options Context ────────────────────────────────────────────────
export interface OptionsContextValue {
  options: StartOptions;
  setOptions: React.Dispatch<React.SetStateAction<StartOptions>>;
}

export const OptionsContext = React.createContext<OptionsContextValue>({
  options: DEFAULT_START_OPTIONS,
  setOptions: () => {},
});
