import { useEffect, useState } from "react";
import type { WeatherDTO } from "@/types";
import client from "@/utils/client";

/**
 * The simulator's global weather speed factor.
 *
 * Worth surfacing because it is the one ETA input that moves under a route
 * that has already been assigned: every other term (learned speeds, node
 * delays, turn costs) is fixed once a route is priced, so when every ETA on
 * screen shifts at once, this is why. Without it the operator sees the whole
 * fleet slow down for no visible reason.
 *
 * Seeded from `GET /weather` and kept current from the `weather` channel. The
 * endpoint is always mounted — the simulator constructs its weather manager
 * whether or not polling is enabled, reporting `clear` at factor 1 when it is
 * off — so this never has to branch on the feature being turned on.
 */
export function useWeather(): WeatherDTO | null {
  const [weather, setWeather] = useState<WeatherDTO | null>(null);

  useEffect(() => {
    let live = true;

    const load = () => {
      client
        .getWeather()
        .then((response) => {
          if (live && response.data) setWeather(response.data);
        })
        .catch((error) => console.error("Failed to load weather:", error));
    };

    load();
    // A reconnect can have missed a change while the socket was down, so the
    // state is re-read rather than waiting for the next poll to push one.
    const connectHandler = () => load();
    const weatherHandler = (data: WeatherDTO) => setWeather(data);

    client.onConnect(connectHandler);
    client.onWeather(weatherHandler);

    return () => {
      live = false;
      client.offConnect(connectHandler);
      client.offWeather(weatherHandler);
    };
  }, []);

  return weather;
}
