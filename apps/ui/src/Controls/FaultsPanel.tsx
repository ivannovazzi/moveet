import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button, Switch, SquaredButton } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import { Eyebrow, LList, LRow, Tag, mono, type SevTone } from "@/Dock/DockPanelKit";
import { PanelEmptyState, PanelErrorState, PanelLoadingState } from "./PanelPrimitives";
import { WarningTriangle } from "@/components/Icons";
import { FAULT_KIND_LABEL, FAULT_PRESETS, describeProfile, matchPreset } from "@/lib/faultPresets";
import type { UseFaults } from "@/hooks/useFaults";
import type { DeviceFaultKind, DeviceFaultStatus } from "@/types";

/** The counters worth a headline; the rest read as per-kind trigger totals. */
const LIVE_METRICS: { key: keyof DeviceFaultStatus; label: string; tone: SevTone }[] = [
  { key: "devices", label: "devices", tone: "idle" },
  { key: "frozen", label: "frozen", tone: "warn" },
  { key: "teleporting", label: "spoofing", tone: "warn" },
  { key: "dead", label: "dead", tone: "error" },
  { key: "held", label: "held", tone: "idle" },
  { key: "queued", label: "queued", tone: "idle" },
];

export interface FaultsPanelProps {
  faults: UseFaults;
  /** Roster used to name profile rows and to arm a specific device. */
  vehicles: { id: string; name: string }[];
  /** Currently selected vehicle, pre-selected in the per-device arming control. */
  selectedVehicleId?: string;
}

/**
 * Device fault injection, as an operator surface.
 *
 * Faults are properties of the simulated DEVICE — a tracker that freezes, skews
 * its clock, retransmits, or dies — so this panel is about arming misbehaviour
 * and watching it happen, not about the vehicles themselves.
 *
 * Profiles are authored from presets rather than a form over all six fault
 * groups: the useful operator question is "make this device flaky", and a
 * 15-field nested form answers a question nobody asked. The REST API stays open
 * for the arbitrary case.
 */
export default function FaultsPanel({ faults, vehicles, selectedVehicleId }: FaultsPanelProps) {
  const { config, status, loading, error } = faults;
  const [targetId, setTargetId] = useState<string>("");
  const [seedDraft, setSeedDraft] = useState<string | null>(null);

  const target = targetId || selectedVehicleId || vehicles[0]?.id || "";

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles) map.set(v.id, v.name);
    return map;
  }, [vehicles]);

  const vehicleProfiles = Object.entries(config?.vehicles ?? {});
  const activePreset = matchPreset(config?.default);
  const enabled = config?.enabled ?? false;
  // Armed but with nothing to inject: worth saying, since the counters will sit
  // at zero and look like a broken feature.
  const nothingArmed = enabled && !config?.default && vehicleProfiles.length === 0;

  if (loading && !config)
    return <PanelLoadingState>Reading fault configuration…</PanelLoadingState>;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-[15px] pb-3 pt-1">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Fault layer</Eyebrow>
          <label className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
            <span>{enabled ? "Armed" : "Off"}</span>
            <Switch
              isSelected={enabled}
              onChange={(next) => void faults.configure({ enabled: next })}
              aria-label="Enable device fault injection"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 text-[10.5px] text-muted-foreground">
            <span className="whitespace-nowrap" title="Seeded runs are reproducible">
              Seed
            </span>
            <Input
              type="number"
              value={seedDraft ?? (config?.seed != null ? String(config.seed) : "")}
              placeholder="unseeded"
              aria-label="Fault RNG seed"
              onChange={(e) => setSeedDraft(e.target.value)}
              onBlur={() => {
                if (seedDraft === null) return;
                const parsed = Number(seedDraft);
                setSeedDraft(null);
                if (!Number.isInteger(parsed)) return;
                if (parsed === config?.seed) return;
                void faults.configure({ seed: parsed });
              }}
              className={cn(mono, "h-7 w-24 text-[11px]")}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void faults.reset()}
            title="Clear dead batteries, frozen windows and withheld samples — keeps the configuration"
          >
            Clear state
          </Button>
        </div>

        {nothingArmed && (
          <p className="rounded-md border border-status-warn/35 bg-status-warn/[0.07] px-2.5 py-1.5 text-[11px] text-foreground">
            Armed, but no profile is set — pick a fleet-wide preset or arm one device below.
          </p>
        )}
      </div>

      {error ? (
        <div className="px-[15px] pb-2">
          <PanelErrorState>{error}</PanelErrorState>
        </div>
      ) : null}

      {/* ── Live device state ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-[15px] pb-3">
        <Eyebrow>Live</Eyebrow>
        <div className="grid grid-cols-3 gap-1.5">
          {LIVE_METRICS.map(({ key, label, tone }) => {
            const value = (status?.[key] as number | undefined) ?? 0;
            return (
              <div
                key={key}
                className={cn(
                  "flex flex-col rounded-md border border-border-soft px-2 py-1.5",
                  value > 0 && tone === "error" && "border-status-error/40",
                  value > 0 && tone === "warn" && "border-status-warn/40"
                )}
              >
                <span
                  className={cn(
                    mono,
                    "text-[13px] font-semibold",
                    value === 0
                      ? "text-muted-foreground"
                      : tone === "error"
                        ? "text-status-error"
                        : tone === "warn"
                          ? "text-status-warn"
                          : "text-foreground"
                  )}
                >
                  {value}
                </span>
                <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        {status && <TriggerCounts counts={status.counts} />}
      </div>

      {/* ── Fleet-wide profile ────────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-[15px] pb-3">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Fleet default</Eyebrow>
          {config?.default && (
            <button
              type="button"
              className="text-[10.5px] text-muted-foreground underline-offset-2 hover:text-status-error hover:underline"
              onClick={() => void faults.configure({ default: null })}
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {FAULT_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.hint}
                aria-pressed={active}
                onClick={() => void faults.configure({ default: preset.profile })}
                className={cn(
                  "rounded-md px-2 py-[3px] text-[10.5px] font-medium",
                  "transition-[color,background-color] duration-fast ease-standard",
                  active
                    ? "bg-foreground/[0.06] text-foreground shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
                    : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className={cn(mono, "text-[10.5px] text-muted-foreground/60")}>
          {config?.default ? describeProfile(config.default) : "No fleet-wide profile"}
        </p>
      </div>

      {/* ── Per-device profiles ───────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-[15px] pb-2">
        <Eyebrow>Per device</Eyebrow>
        <div className="flex items-center gap-1.5">
          <select
            value={target}
            aria-label="Vehicle to arm"
            onChange={(e) => setTargetId(e.target.value)}
            className={cn(
              "h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-1.5 text-[11px] text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {vehicles.length === 0 && <option value="">No vehicles</option>}
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            defaultValue=""
            aria-label="Fault preset to arm"
            disabled={!target}
            onChange={(e) => {
              const preset = FAULT_PRESETS.find((p) => p.id === e.target.value);
              if (!preset || !target) return;
              void faults.setVehicleProfile(target, preset.profile);
              e.target.value = "";
            }}
            className={cn(
              "h-7 rounded-md border border-border bg-transparent px-1.5 text-[11px] text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            <option value="">Arm preset…</option>
            {FAULT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {vehicleProfiles.length === 0 ? (
        <div className="px-[15px] pb-3">
          <PanelEmptyState icon={<WarningTriangle />}>
            No device has its own profile — every vehicle uses the fleet default
          </PanelEmptyState>
        </div>
      ) : (
        <LList className="px-2 pb-2.5 pt-0">
          {vehicleProfiles.map(([vehicleId, profile]) => (
            <LRow
              key={vehicleId}
              tone="warn"
              primary={nameById.get(vehicleId) ?? vehicleId}
              secondary={describeProfile(profile)}
              meta={
                <SquaredButton
                  className="flex-shrink-0"
                  icon={<span aria-hidden="true">×</span>}
                  variant="ghost"
                  tone="danger"
                  aria-label={`Clear fault profile for ${nameById.get(vehicleId) ?? vehicleId}`}
                  title="Clear this device's profile"
                  onClick={() => void faults.clearVehicleProfile(vehicleId)}
                />
              }
            />
          ))}
        </LList>
      )}
    </div>
  );
}

/** Cumulative per-kind trigger totals since the last state clear. */
function TriggerCounts({ counts }: { counts: Record<DeviceFaultKind, number> }) {
  const fired = (Object.entries(counts) as [DeviceFaultKind, number][]).filter(([, n]) => n > 0);
  if (fired.length === 0) {
    return (
      <p className={cn(mono, "text-[10.5px] text-muted-foreground/60")}>No faults injected yet</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {fired.map(([kind, n]) => (
        <Tag key={kind} tone="warn">
          {FAULT_KIND_LABEL[kind]} {n}
        </Tag>
      ))}
    </div>
  );
}
