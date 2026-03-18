import type { TimeOfDay } from "@/types";
import { useClock } from "@/hooks/useClock";
import { PanelBody } from "./PanelPrimitives";
import styles from "./ClockPanel.module.css";
import { Slider, SliderTrack, SliderThumb, Button } from "react-aria-components";

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning_rush: "Morning Rush",
  midday: "Midday",
  evening_rush: "Evening Rush",
  night: "Night",
};

const SPEED_PRESETS = [
  { label: "1×", value: 1 },
  { label: "60×", value: 60 },
  { label: "360×", value: 360 },
  { label: "3600×", value: 3600 },
];

const MAX_MULTIPLIER = 3600;
const LOG_MAX = Math.log10(MAX_MULTIPLIER);

function multiplierToSlider(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return Math.round((Math.log10(Math.max(1, multiplier)) / LOG_MAX) * 100);
}

function sliderToMultiplier(slider: number): number {
  if (slider <= 0) return 1;
  return Math.round(Math.pow(10, (slider / 100) * LOG_MAX));
}

function speedDescription(multiplier: number): string {
  if (multiplier === 1) return "real-time";
  if (multiplier === 60) return "1 sim-min per second";
  if (multiplier === 3600) return "1 sim-hour per second";
  if (multiplier % 3600 === 0) return `${multiplier / 3600} sim-hours per second`;
  if (multiplier % 60 === 0) return `${multiplier / 60} sim-mins per second`;
  return `${multiplier}× speed`;
}

export default function ClockPanel() {
  const { clock, setSpeedMultiplier } = useClock();

  const timeStr = new Date(clock.currentTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const sliderValue = multiplierToSlider(clock.speedMultiplier);
  const isRealTime = clock.speedMultiplier === 1;

  function handleSliderChange(value: number) {
    setSpeedMultiplier(sliderToMultiplier(value));
  }

  return (
    <>
      <div className={styles.clockHeader}>
        <span className={styles[`eyebrow_${clock.timeOfDay}`]}>
          {TIME_OF_DAY_LABELS[clock.timeOfDay]}
        </span>
        <div className={styles.timeValue}>{timeStr}</div>
        <p className={styles.subtitle}>Nairobi Fleet Simulation</p>
      </div>
      <PanelBody className={styles.body}>
        <div className={styles.speedSection}>
          <span className={styles.sectionLabel}>SIMULATION SPEED</span>
          <Slider
            className={styles.slider}
            minValue={0}
            maxValue={100}
            value={sliderValue}
            onChange={handleSliderChange}
            aria-label="Speed multiplier"
          >
            <SliderTrack className={styles.sliderTrack}>
              <SliderThumb className={styles.sliderThumb} aria-label="Speed multiplier" />
            </SliderTrack>
          </Slider>
          <div className={styles.speedSummary}>
            <span className={isRealTime ? styles.speedValueNeutral : styles.speedValueAccent}>
              {clock.speedMultiplier}×
            </span>
            <span className={styles.speedDot}>·</span>
            <span className={styles.speedDesc}>{speedDescription(clock.speedMultiplier)}</span>
          </div>
        </div>

        <div className={styles.presets}>
          {SPEED_PRESETS.map(({ label, value }) => (
            <Button
              key={value}
              className={`${styles.presetBtn} ${clock.speedMultiplier === value ? styles.presetBtnActive : ""}`}
              onPress={() => setSpeedMultiplier(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </PanelBody>
    </>
  );
}
