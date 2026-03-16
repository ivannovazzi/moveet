import { useContext } from "react";
import {
  RoadsContext,
  POIContext,
  DirectionContext,
  HeatZoneContext,
  NetworkContext,
  OptionsContext,
} from "./context";

/** Use the specific context hooks below instead of useData for better performance. */
export default function useData() {
  const { options, setOptions } = useContext(OptionsContext);
  const { roads, setRoads } = useContext(RoadsContext);
  const { pois, setPOIs } = useContext(POIContext);
  const { directions, setDirections } = useContext(DirectionContext);
  const { heatzones, setHeatzones } = useContext(HeatZoneContext);
  const { network, setNetwork } = useContext(NetworkContext);

  return {
    options,
    roads,
    pois,
    directions,
    heatzones,
    network,
    setOptions,
    setRoads,
    setPOIs,
    setDirections,
    setHeatzones,
    setNetwork,
  };
}

export function useOptionsContext() {
  return useContext(OptionsContext);
}

export function useRoadsContext() {
  return useContext(RoadsContext);
}

export function usePOIContext() {
  return useContext(POIContext);
}

export function useDirectionContext() {
  return useContext(DirectionContext);
}

export function useHeatZoneContext() {
  return useContext(HeatZoneContext);
}

export function useNetworkContext() {
  return useContext(NetworkContext);
}
