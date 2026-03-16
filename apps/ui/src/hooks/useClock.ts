import { useState, useEffect, useRef } from "react";
import client from "@/utils/client";
import type { ClockState } from "@/types";

const DEFAULT_CLOCK: ClockState = {
  currentTime: new Date().toISOString(),
  speedMultiplier: 1,
  hour: 7,
  timeOfDay: "morning_rush",
};

export function useClock() {
  const [clock, setClock] = useState<ClockState>(DEFAULT_CLOCK);
  // Keep a ref to the latest clock so the interval closure always reads current values
  const clockRef = useRef(clock);
  clockRef.current = clock;

  useEffect(() => {
    client.getClock().then((res) => {
      if (res.data) setClock(res.data);
    });
    // WS events fire on hour boundaries — sync full state when they arrive
    client.onClock((state) => setClock(state));
  }, []);

  // Local tick — advance currentTime every real second based on speedMultiplier
  useEffect(() => {
    const id = setInterval(() => {
      setClock((prev) => ({
        ...prev,
        currentTime: new Date(
          new Date(prev.currentTime).getTime() + prev.speedMultiplier * 1000
        ).toISOString(),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  async function setSpeedMultiplier(value: number) {
    const res = await client.setClock({ speedMultiplier: value });
    if (res.data) setClock(res.data);
  }

  async function setTime(isoString: string) {
    const res = await client.setClock({ setTime: isoString });
    if (res.data) setClock(res.data);
  }

  return { clock, setSpeedMultiplier, setTime };
}
