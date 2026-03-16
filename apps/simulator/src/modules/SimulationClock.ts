import EventEmitter from "events";

export type TimeOfDay = "morning_rush" | "midday" | "evening_rush" | "night";

export interface ClockState {
  currentTime: Date;
  speedMultiplier: number;
  hour: number;
  timeOfDay: TimeOfDay;
}

export class SimulationClock extends EventEmitter {
  private _currentTime: Date;
  private _speedMultiplier: number;
  private _lastHour: number;

  constructor(options: { startHour?: number; speedMultiplier?: number } = {}) {
    super();
    // Default start: 7am (morning rush)
    const startHour = options.startHour ?? 7;
    this._speedMultiplier = options.speedMultiplier ?? 1;
    this._currentTime = new Date();
    this._currentTime.setHours(startHour, 0, 0, 0);
    this._lastHour = startHour;
  }

  tick(deltaMs: number): void {
    // Advance simulation time by deltaMs * speedMultiplier
    const simDeltaMs = deltaMs * this._speedMultiplier;
    this._currentTime = new Date(this._currentTime.getTime() + simDeltaMs);
    const newHour = this._currentTime.getHours();
    if (newHour !== this._lastHour) {
      this._lastHour = newHour;
      this.emit("hour:changed", newHour, this.getTimeOfDay());
    }
  }

  getHour(): number {
    return this._currentTime.getHours();
  }

  getTimeOfDay(): TimeOfDay {
    const h = this.getHour();
    if (h >= 7 && h < 9) return "morning_rush";
    if (h >= 17 && h < 19) return "evening_rush";
    if (h >= 22 || h < 5) return "night";
    return "midday";
  }

  getState(): ClockState {
    return {
      currentTime: new Date(this._currentTime),
      speedMultiplier: this._speedMultiplier,
      hour: this.getHour(),
      timeOfDay: this.getTimeOfDay(),
    };
  }

  setSpeedMultiplier(multiplier: number): void {
    if (multiplier < 0) throw new Error("Speed multiplier must be non-negative");
    this._speedMultiplier = multiplier;
  }

  setTime(time: Date): void {
    const oldHour = this._lastHour;
    this._currentTime = new Date(time);
    this._lastHour = this._currentTime.getHours();
    if (this._lastHour !== oldHour) {
      this.emit("hour:changed", this._lastHour, this.getTimeOfDay());
    }
  }

  reset(): void {
    const startTime = new Date();
    startTime.setHours(7, 0, 0, 0);
    this._currentTime = startTime;
    this._speedMultiplier = 1;
    this._lastHour = 7;
  }
}
