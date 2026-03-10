import type { Position } from "@/types";

export const calculateRotation = (current: number, target: number) => {
  const normalizedCurrent = ((current % 360) + 360) % 360;
  const normalizedTarget = ((target % 360) + 360) % 360;

  let diff = normalizedTarget - normalizedCurrent;

  // Ensure we take the shortest path
  if (diff > 180) {
    diff -= 360;
  } else if (diff < -180) {
    diff += 360;
  }

  return diff;
};

export function invertLatLng([a, b]: Position): Position {
  return [b, a];
}
