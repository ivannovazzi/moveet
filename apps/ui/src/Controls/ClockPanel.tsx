import type { TimeOfDay } from "@/types";
import { useClock } from "@/hooks/useClock";
import { PanelBody, PanelHeader } from "./PanelPrimitives";
import styles from "./ClockPanel.module.css";

const TIME_OF_DAY_META: Record<TimeOfDay, { label: string; emoji: string }> = {
  morning_rush: { label: "Morning Rush", emoji: "🌅" },
  midday: { label: "Midday", emoji: "☀️" },
  evening_rush: { label: "Evening Rush", emoji: "🌆" },
  night: { label: "Night", emoji: "🌙" },
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
  if (multiplier < 60) return `${multiplier}× speed`;
  if (multiplier === 60) return "1 sim-min / real-sec";
  if (multiplier === 3600) return "1 sim-hr / real-sec";
  if (multiplier % 3600 === 0) return `${multiplier / 3600} sim-hr / real-sec`;
  if (multiplier % 60 === 0) return `${multiplier / 60} sim-min / real-sec`;
  return `${multiplier}× speed`;
}

export default function ClockPanel() {
  const { clock, setSpeedMultiplier } = useClock();

  const timeStr = new Date(clock.currentTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const meta = TIME_OF_DAY_META[clock.timeOfDay];
  const sliderValue = multiplierToSlider(clock.speedMultiplier);

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSpeedMultiplier(sliderToMultiplier(Number(e.target.value)));
  }

  return (
    <>
      <PanelHeader title="Simulation Clock" subtitle="Current simulation time and speed controls." />
      <PanelBody className={styles.body}>
        <div className={styles.timeDisplay}>
          <span className={styles.timeValue}>{timeStr}</span>
          <span className={`${styles.badge} ${styles[`badge_${clock.timeOfDay}`]}`}>
            {meta.emoji} {meta.label}
          </span>
        </div>

        <div className={styles.speedSection}>
          <div className={styles.speedHeader}>
            <span className={styles.speedLabel}>Simulation Speed</span>
            <span className={styles.speedValue}>{clock.speedMultiplier}×</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={100}
            value={sliderValue}
            onChange={handleSliderChange}
            aria-label="Speed multiplier"
          />
          <span className={styles.speedDesc}>{speedDescription(clock.speedMultiplier)}</span>
        </div>

        <div className={styles.presets}>
          {SPEED_PRESETS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              className={`${styles.presetBtn} ${clock.speedMultiplier === value ? styles.presetBtnActive : ""}`}
              onClick={() => setSpeedMultiplier(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </PanelBody>
    </>
  );
}
