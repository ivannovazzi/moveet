import { useState, useEffect } from "react";
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

  useEffect(() => {
    client.getClock().then((res) => {
      if (res.data) setClock(res.data);
    });
    client.onClock((state) => setClock(state));
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
