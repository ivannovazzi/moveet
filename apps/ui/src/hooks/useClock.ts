import { useState, useEffect, useRef } from "react";
import client from "@/utils/client";
import type { ClockState, TimeOfDay } from "@/types";

function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 7 && hour < 9) return "morning_rush";
  if (hour >= 17 && hour < 19) return "evening_rush";
  if (hour >= 22 || hour < 5) return "night";
  return "midday";
}

const DEFAULT_CLOCK: ClockState = {
  currentTime: new Date().toISOString(),
  speedMultiplier: 1,
  hour: 7,
  timeOfDay: "morning_rush",
};

export function useClock() {
  const [clock, setClock] = useState<ClockState>(DEFAULT_CLOCK);
  const clockRef = useRef(clock);
  clockRef.current = clock;

  useEffect(() => {
    client.getClock().then((res) => {
      if (res.data) setClock(res.data);
    });
    client.onClock((state) => setClock(state));
  }, []);

  // Local tick — advance currentTime and derive hour/timeOfDay every real second
  useEffect(() => {
    const id = setInterval(() => {
      setClock((prev) => {
        const nextTime = new Date(
          new Date(prev.currentTime).getTime() + prev.speedMultiplier * 1000
        );
        const hour = nextTime.getHours();
        return {
          ...prev,
          currentTime: nextTime.toISOString(),
          hour,
          timeOfDay: getTimeOfDay(hour),
        };
      });
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
