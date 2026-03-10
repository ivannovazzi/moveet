import classNames from "classnames";
import { useCallback } from "react";
import client from "@/utils/client";
import type { Modifiers, SimulationStatus, StartOptions, Vehicle } from "@/types";
import styles from "./Controls.module.css";
import type { Filters } from "@/hooks/useVehicles";
import { useOptions } from "@/hooks/useOptions";
import { Switch } from "@/components/Inputs";
import { eValue } from "@/utils/form";
import { Flame, Gear, Pause, Play, Reset } from "@/components/Icons";
import useTracking from "./useTracking";
import HealthBadge from "./Adapter/HealthBadge";
import type { AdapterStatus } from "./Adapter/useAdapterConfig";

interface ControlPanelProps {
  vehicles: Vehicle[];
  status: SimulationStatus;
  connected: boolean;
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
  filters: Filters;
  maxSpeedRef: React.MutableRefObject<number>;
  isVehiclePanelOpen: boolean;
  onToggleVehiclePanel: () => void;
  isAdapterPanelOpen: boolean;
  onToggleAdapterPanel: () => void;
  adapterStatus: AdapterStatus;
}

const toggles: { key: keyof Modifiers; label: string }[] = [
  { key: "showDirections", label: "Network" },
  { key: "showVehicles", label: "Vehicles" },
  { key: "showHeatmap", label: "Heatmap" },
  { key: "showHeatzones", label: "Zones" },
  { key: "showPOIs", label: "POIs" },
];

const sliders: {
  key: keyof StartOptions;
  label: string;
  min: number;
  max: number;
  step?: number;
}[] = [
  { key: "maxSpeed", label: "Speed", min: 10, max: 120 },
  { key: "acceleration", label: "Accel", min: 1, max: 10 },
  { key: "deceleration", label: "Decel", min: 1, max: 10 },
  { key: "updateInterval", label: "Interval", min: 50, max: 2000, step: 50 },
];

export default function ControlPanel({
  vehicles,
  status,
  connected,
  modifiers,
  filters,
  onChangeModifiers,
  maxSpeedRef,
  isVehiclePanelOpen,
  onToggleVehiclePanel,
  isAdapterPanelOpen,
  onToggleAdapterPanel,
  adapterStatus,
}: ControlPanelProps) {
  const { options, updateOption } = useOptions(300);

  useTracking(vehicles, filters.selected, status.interval);
  maxSpeedRef.current = options.maxSpeed;

  const handleReset = useCallback(async () => {
    await client.reset();
  }, []);

  const handleChange = (field: keyof StartOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    updateOption(field, Number(e.target.value) as StartOptions[typeof field]);
  };

  const handleStart = () => client.start(options);
  const statusChips = [
    {
      key: "ws",
      label: "WS",
      value: connected ? "Live" : "Offline",
      active: connected,
    },
    {
      key: "sim",
      label: "SIM",
      value: status.running ? "Running" : "Paused",
      active: status.running,
    },
  ] as const;

  const formatOptionValue = (key: keyof StartOptions, value: StartOptions[keyof StartOptions]) => {
    if (key === "maxSpeed") return `${value} km/h`;
    if (key === "updateInterval") return `${value} ms`;
    return `${value}`;
  };

  return (
    <section className={styles.controlPanel}>
      <div className={styles.mainButtonGroup}>
        <button
          onClick={status.running ? client.stop : handleStart}
          className={`${styles.mainButton} ${status.running ? styles.mainButtonActive : ""}`}
          aria-label={status.running ? "Pause" : "Start"}
        >
          {status.running ? (
            <Pause className={styles.mainButtonIcon} />
          ) : (
            <Play className={styles.mainButtonIcon} />
          )}
        </button>
        <button onClick={handleReset} className={styles.mainButton} aria-label="Reset">
          <Reset className={styles.mainButtonIcon} />
        </button>
        <button onClick={client.makeHeatzones} className={styles.mainButton} aria-label="Zones">
          <Flame className={styles.mainButtonIcon} />
        </button>
      </div>

      {statusChips.map(({ key, label, value, active }) => (
        <span
          key={key}
          className={classNames(styles.statusChip, {
            [styles.statusChipActive]: active,
          })}
          title={`${label}: ${value}`}
        >
          <span className={`${styles.ledDot} ${active ? styles.ledOn : styles.ledDim}`} />
          <span className={styles.ledLabel}>{label}</span>
          <span className={styles.statusValue}>{value}</span>
        </span>
      ))}
      <button
        type="button"
        className={classNames(styles.vehicleCount, {
          [styles.panelToggleActive]: isVehiclePanelOpen,
        })}
        onClick={onToggleVehiclePanel}
        aria-pressed={isVehiclePanelOpen}
        title={isVehiclePanelOpen ? "Hide vehicle sidebar" : "Show vehicle sidebar"}
      >
        <span className={styles.vehicleCountValue}>{vehicles.length}</span>
        <span className={styles.vehicleCountLabel}>fleet</span>
      </button>

      {toggles.map(({ key, label }) => (
        <label
          key={key}
          className={classNames(styles.toggle, {
            [styles.toggleActive]: modifiers[key],
          })}
        >
          <Switch
            type="checkbox"
            checked={modifiers[key]}
            onChange={eValue(onChangeModifiers(key))}
            aria-label={label}
          />
          <span className={styles.toggleLabel}>{label}</span>
        </label>
      ))}

      {sliders.map(({ key, label, min, max, step }, index) => (
        <label
          key={key}
          className={classNames(styles.option, {
            [styles.firstOption]: index === 0,
          })}
        >
          <span className={styles.optionLabel}>{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={options[key]}
            onChange={handleChange(key)}
            className={styles.optionSlider}
          />
          <span className={styles.optionValue}>{formatOptionValue(key, options[key])}</span>
        </label>
      ))}

      <button
        type="button"
        className={classNames(styles.gearButton, {
          [styles.panelToggleActive]: isAdapterPanelOpen,
        })}
        onClick={onToggleAdapterPanel}
        title={isAdapterPanelOpen ? "Hide adapter panel" : "Show adapter panel"}
        aria-pressed={isAdapterPanelOpen}
      >
        <Gear />
        <span className={styles.gearLabel}>Adapter</span>
        <HealthBadge status={adapterStatus} />
      </button>
    </section>
  );
}
