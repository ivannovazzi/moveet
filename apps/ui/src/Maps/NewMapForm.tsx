import { useEffect, useId, useRef, useState } from "react";
import { Button, Switch } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import { controlsRef } from "@/components/Map/providers/controls";
import { Eyebrow, SegTabs, mono } from "@/Dock/DockPanelKit";
import { cn } from "@/lib/utils";
import { clearAreaDraft, setDraftArea, setDrawing, useAreaDraft } from "./areaDraft";
import {
  bboxAreaKm2,
  bboxCorners,
  bboxProblem,
  estimateNetworkBytes,
  formatArea,
  formatBytes,
  formatCentre,
} from "./bbox";
import {
  findGeofabrik,
  geocode,
  type Bbox,
  type GeocodeCandidate,
  type GeofabrikRegion,
  type MapBuildRequest,
  type MapLibrary,
  type MapPreset,
} from "./mapsClient";
import { startBuild, useMapsState } from "./mapsStore";

type AreaMode = "preset" | "search" | "draw";

const MODES: { value: AreaMode; label: string }[] = [
  { value: "preset", label: "Preset" },
  { value: "search", label: "Search" },
  { value: "draw", label: "Draw" },
];

/** Wait this long after the last keystroke before asking the geocoder. */
export const GEOCODE_DEBOUNCE_MS = 400;
/** After a 429, try the same query again this much later. */
export const GEOCODE_RETRY_MS = 1500;
const MIN_QUERY = 2;
const MAX_LABEL = 64;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";

const OPTION_ROW = cn(
  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast ease-standard hover:bg-foreground/[0.04]",
  "aria-pressed:bg-accent/12 aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent)]",
  FOCUS_RING
);

/** Frame the camera on the chosen box, so the preview is on screen. */
function frame(bbox: Bbox): void {
  controlsRef.setBounds(bboxCorners(bbox));
}

/**
 * The New map flow: choose an area (a preset, a place search, or a rectangle
 * dragged on the map), check it against the server's caps and the Geofabrik
 * extract it would be cut from, then start the build.
 */
export default function NewMapForm({
  library,
  onClose,
}: {
  library: MapLibrary | null;
  onClose: () => void;
}) {
  const { presets } = useMapsState();
  const draft = useAreaDraft();
  const [mode, setMode] = useState<AreaMode>("preset");
  const [preset, setPreset] = useState<MapPreset | null>(null);
  const [label, setLabel] = useState("");
  const [labelEdited, setLabelEdited] = useState(false);
  const [buildings, setBuildings] = useState(true);
  const [activateWhenDone, setActivateWhenDone] = useState(false);
  const [regionPath, setRegionPath] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const ids = { label: useId(), buildings: useId(), activate: useId() };

  // The preview belongs to this form: drop it when the form goes away.
  useEffect(() => () => clearAreaDraft(), []);

  const bbox = draft.origin === mode ? draft.bbox : null;
  const usingPreset = mode === "preset" && preset !== null && bbox !== null;

  const suggestLabel = (text: string) => {
    if (!labelEdited) setLabel(text.slice(0, MAX_LABEL));
  };

  const changeMode = (next: AreaMode) => {
    if (next === mode) return;
    setMode(next);
    setPreset(null);
    setSubmitError(null);
    // A name suggested by the old area does not describe the next one.
    if (!labelEdited) setLabel("");
    clearAreaDraft();
  };

  const choosePreset = (p: MapPreset) => {
    setPreset(p);
    setDraftArea(p.bbox, "preset");
    suggestLabel(p.label);
    frame(p.bbox);
  };

  const chooseCandidate = (c: GeocodeCandidate) => {
    setDraftArea(c.bbox, "search");
    suggestLabel(c.name.split(",")[0].trim());
    frame(c.bbox);
  };

  // ── Checks ─────────────────────────────────────────────────────────
  const maxArea = library?.builds?.limits.maxAreaKm2 ?? null;
  const area = bbox
    ? usingPreset && preset?.areaKm2 != null
      ? preset.areaKm2
      : bboxAreaKm2(bbox)
    : null;
  const overCap = area !== null && maxArea !== null && area > maxArea;
  const shapeProblem = bbox ? bboxProblem(bbox) : null;
  const estimate = bbox && library ? estimateNetworkBytes(bbox, library.maps) : null;

  // A preset names its own extract; any other box is looked up.
  const lookupBbox = bbox && !usingPreset && !overCap && !shapeProblem ? bbox : null;
  const lookup = useGeofabrikLookup(lookupBbox);
  const region: GeofabrikRegion | null = usingPreset
    ? preset?.geofabrik
      ? { path: preset.geofabrik, name: preset.geofabrik }
      : null
    : (lookup.regions?.find((r) => r.path === regionPath) ?? lookup.regions?.[0] ?? null);

  const trimmedLabel = label.trim();
  const problems: string[] = [];
  if (!bbox) problems.push("Choose an area.");
  if (shapeProblem) problems.push(shapeProblem);
  if (overCap && maxArea !== null) {
    problems.push(`The area is over the ${formatArea(maxArea)} limit. Choose a smaller one.`);
  }
  if (bbox && !usingPreset && !overCap && !shapeProblem) {
    if (lookup.loading) problems.push("Looking up the source extract.");
    else if (lookup.error) problems.push(`Could not find a source extract: ${lookup.error}`);
    else if (lookup.regions && lookup.regions.length === 0) {
      problems.push("No Geofabrik extract covers this area.");
    }
  }
  if (!usingPreset && !trimmedLabel) problems.push("Give the map a name.");
  const canBuild = problems.length === 0 && !submitting;

  const submit = async () => {
    if (!canBuild || !bbox) return;
    const common = { buildings, activate: activateWhenDone };
    let req: MapBuildRequest;
    if (usingPreset && preset) {
      req = { preset: preset.name, ...(trimmedLabel ? { label: trimmedLabel } : {}), ...common };
    } else if (region) {
      req = { label: trimmedLabel, bbox, geofabrik: region.path, ...common };
    } else {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const res = await startBuild(req);
    setSubmitting(false);
    if (res.ok) onClose();
    else setSubmitError(res.error);
  };

  const quota = library?.builds?.limits;
  const nearQuota =
    quota?.diskQuotaBytes != null &&
    quota.diskUsedBytes != null &&
    quota.diskUsedBytes + (estimate ?? 0) >= quota.diskQuotaBytes;

  return (
    <form
      aria-label="New map"
      className="flex flex-col gap-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-[15px]">
        <Eyebrow>New map</Eyebrow>
        <Button size="xs" variant="ghost" type="button" onClick={onClose}>
          Back to library
        </Button>
      </div>

      <SegTabs tabs={MODES} value={mode} onChange={changeMode} ariaLabel="Choose the area by" />

      <div className="flex flex-col gap-2 px-[15px]">
        {mode === "preset" && (
          <PresetPicker presets={presets} selected={preset?.name ?? null} onPick={choosePreset} />
        )}
        {mode === "search" && (
          <PlaceSearch
            selected={draft.origin === "search" ? draft.bbox : null}
            onPick={chooseCandidate}
          />
        )}
        {mode === "draw" && <DrawControl drawing={draft.drawing} hasBox={bbox !== null} />}
      </div>

      {bbox && (
        <dl className="mx-[15px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border-soft px-3 py-2 text-meta">
          <dt className="text-muted-foreground">Centre</dt>
          <dd className={mono}>{formatCentre(bbox)}</dd>
          <dt className="text-muted-foreground">Area</dt>
          <dd className={cn(mono, overCap && "text-status-error")}>
            {area !== null ? formatArea(area) : "?"}
            {maxArea !== null && (
              <span className="text-muted-foreground"> of {formatArea(maxArea)} max</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="min-w-0">
            <SourceLine
              usingPreset={usingPreset}
              region={region}
              lookup={lookup}
              blocked={overCap || shapeProblem !== null}
              selectedPath={region?.path ?? null}
              onSelect={setRegionPath}
            />
          </dd>
          {estimate !== null && (
            <>
              <dt className="text-muted-foreground">Estimate</dt>
              <dd className={mono}>
                about {formatBytes(estimate)} of roads
                <span className="font-sans text-muted-foreground"> (from your library)</span>
              </dd>
            </>
          )}
        </dl>
      )}

      <div className="flex flex-col gap-2.5 px-[15px]">
        <label htmlFor={ids.label} className="flex flex-col gap-1 text-micro text-muted-foreground">
          Name
          <Input
            id={ids.label}
            value={label}
            maxLength={MAX_LABEL}
            placeholder={usingPreset ? preset?.label : "e.g. Lisbon centre"}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelEdited(true);
            }}
          />
        </label>
        <label
          htmlFor={ids.buildings}
          className="flex cursor-pointer items-center gap-2 text-meta text-muted-foreground"
        >
          <Switch id={ids.buildings} isSelected={buildings} onChange={setBuildings} />
          Include 3D buildings
        </label>
        <label
          htmlFor={ids.activate}
          className="flex cursor-pointer items-center gap-2 text-meta text-muted-foreground"
        >
          <Switch id={ids.activate} isSelected={activateWhenDone} onChange={setActivateWhenDone} />
          Switch to it when done
        </label>
      </div>

      {nearQuota && (
        <p className="mx-[15px] text-micro leading-snug text-status-warn">
          The library is close to its disk quota. The build may be refused; delete a map to make
          room.
        </p>
      )}

      {problems.length > 0 && bbox && (
        <ul
          aria-label="Why the map cannot be built yet"
          className="mx-[15px] flex flex-col gap-0.5"
        >
          {problems.map((p) => (
            <li key={p} className="text-micro leading-snug text-muted-foreground">
              {p}
            </li>
          ))}
        </ul>
      )}

      {submitError && (
        <p role="alert" className="mx-[15px] text-micro leading-snug text-status-error">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-2 px-[15px]">
        <Button size="sm" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="default" type="submit" disabled={!canBuild}>
          {submitting ? "Starting…" : "Build"}
        </Button>
      </div>
    </form>
  );
}

// ─── Area pickers ────────────────────────────────────────────────────

function PresetPicker({
  presets,
  selected,
  onPick,
}: {
  presets: MapPreset[];
  selected: string | null;
  onPick: (p: MapPreset) => void;
}) {
  if (presets.length === 0) {
    return <p className="text-micro text-muted-foreground">This simulator has no presets.</p>;
  }
  return (
    <ul aria-label="Presets" className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
      {presets.map((p) => (
        <li key={p.name}>
          <button
            type="button"
            aria-pressed={selected === p.name}
            onClick={() => onPick(p)}
            className={OPTION_ROW}
          >
            <span className="text-label text-foreground">{p.label}</span>
            {p.areaKm2 != null && (
              <span className={cn(mono, "text-micro text-muted-foreground/70")}>
                {formatArea(p.areaKm2)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlaceSearch({
  selected,
  onPick,
}: {
  selected: Bbox | null;
  onPick: (c: GeocodeCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const { candidates, loading, error, busy, attribution } = useGeocode(query);
  const inputId = useId();
  const selectedKey = selected?.join(",");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex flex-col gap-1 text-micro text-muted-foreground">
        Place
        <Input
          id={inputId}
          type="search"
          value={query}
          autoComplete="off"
          placeholder="City, district or region"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div
        role="status"
        aria-live="polite"
        className="text-micro text-muted-foreground empty:hidden"
      >
        {loading ? "Searching…" : busy ? "The place search is busy. Trying again in a moment." : ""}
      </div>
      {error && <p className="text-micro text-status-error">{error}</p>}
      {candidates.length > 0 && (
        <ul aria-label="Places" className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {candidates.map((c) => (
            <li key={`${c.name}|${c.bbox.join(",")}`}>
              <button
                type="button"
                aria-pressed={selectedKey === c.bbox.join(",")}
                onClick={() => onPick(c)}
                className={OPTION_ROW}
              >
                <span className="line-clamp-2 text-label text-foreground">{c.name}</span>
                <span className={cn(mono, "text-micro text-muted-foreground/70")}>
                  {formatArea(bboxAreaKm2(c.bbox))}
                  {c.type ? ` · ${c.type}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading &&
        !busy &&
        !error &&
        query.trim().length >= MIN_QUERY &&
        candidates.length === 0 && (
          <p className="text-micro text-muted-foreground">No places found.</p>
        )}
      {attribution && candidates.length > 0 && (
        <p className="text-micro text-muted-foreground/60">{attribution}</p>
      )}
    </div>
  );
}

function DrawControl({ drawing, hasBox }: { drawing: boolean; hasBox: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          type="button"
          variant={drawing ? "default" : "outline"}
          aria-pressed={drawing}
          onClick={() => setDrawing(!drawing)}
        >
          {drawing ? "Stop drawing" : hasBox ? "Redraw on map" : "Draw on map"}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-micro leading-snug text-muted-foreground">
        {drawing
          ? "Drag a rectangle on the map. Esc cancels."
          : hasBox
            ? "Area drawn. Redraw to change it."
            : "Drag out the area to build on the map."}
      </p>
    </div>
  );
}

function SourceLine({
  usingPreset,
  region,
  lookup,
  blocked,
  selectedPath,
  onSelect,
}: {
  usingPreset: boolean;
  region: GeofabrikRegion | null;
  lookup: GeofabrikLookup;
  blocked: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  if (usingPreset) {
    return <span className={mono}>{region ? region.path : "set by the preset"}</span>;
  }
  if (blocked) return <span className="text-muted-foreground">?</span>;
  if (lookup.loading) return <span className="text-muted-foreground">Looking up…</span>;
  if (lookup.error) return <span className="text-status-error">Lookup failed</span>;
  const regions = lookup.regions ?? [];
  if (regions.length === 0) return <span className="text-status-error">No extract covers it</span>;
  if (regions.length === 1) return <RegionText region={regions[0]} />;
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="sr-only">Geofabrik extract</legend>
      {regions.map((r) => (
        <label key={r.path} className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name="geofabrik-region"
            value={r.path}
            checked={(selectedPath ?? region?.path) === r.path}
            onChange={() => onSelect(r.path)}
            className="accent-[var(--color-accent)]"
          />
          <RegionText region={r} />
        </label>
      ))}
    </fieldset>
  );
}

function RegionText({ region }: { region: GeofabrikRegion }) {
  return (
    <span className={cn(mono, "truncate")} title={region.name}>
      {region.path}
      {region.sizeBytes != null && (
        <span className="text-muted-foreground"> · {formatBytes(region.sizeBytes)} download</span>
      )}
    </span>
  );
}

// ─── Lookups ─────────────────────────────────────────────────────────

interface GeofabrikLookup {
  regions: GeofabrikRegion[] | null;
  loading: boolean;
  error: string | null;
}

/** The Geofabrik extracts that contain `bbox`, smallest first. */
function useGeofabrikLookup(bbox: Bbox | null): GeofabrikLookup {
  const key = bbox?.join(",") ?? null;
  const [result, setResult] = useState<GeofabrikLookup & { key: string | null }>({
    key: null,
    regions: null,
    loading: false,
    error: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the box, by value.
  useEffect(() => {
    if (!bbox || !key) return;
    const ac = new AbortController();
    setResult({ key, regions: null, loading: true, error: null });
    findGeofabrik(bbox, ac.signal).then((res) => {
      if (ac.signal.aborted) return;
      setResult(
        res.ok
          ? { key, regions: res.data, loading: false, error: null }
          : { key, regions: null, loading: false, error: res.error }
      );
    });
    return () => ac.abort();
  }, [key]);

  if (!key || result.key !== key) return { regions: null, loading: key !== null, error: null };
  return result;
}

interface GeocodeState {
  candidates: GeocodeCandidate[];
  loading: boolean;
  /** Rate limited: a retry is scheduled. */
  busy: boolean;
  error: string | null;
  attribution?: string;
}

/** Debounced place search. A 429 is retried once, quietly, after a pause. */
function useGeocode(query: string): GeocodeState {
  const [state, setState] = useState<GeocodeState>({
    candidates: [],
    loading: false,
    busy: false,
    error: null,
  });
  const q = query.trim();
  const retried = useRef(false);

  useEffect(() => {
    retried.current = false;
    if (q.length < MIN_QUERY) {
      setState({ candidates: [], loading: false, busy: false, error: null });
      return;
    }
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    const run = async () => {
      setState((s) => ({ ...s, loading: true, busy: false, error: null }));
      const res = await geocode(q, ac.signal);
      if (ac.signal.aborted) return;
      if (res.ok) {
        setState({
          candidates: res.data.candidates,
          attribution: res.data.attribution,
          loading: false,
          busy: false,
          error: null,
        });
      } else if (res.status === 429 && !retried.current) {
        retried.current = true;
        setState((s) => ({ ...s, loading: false, busy: true }));
        timer = setTimeout(run, GEOCODE_RETRY_MS);
      } else if (res.status === 429) {
        setState({
          candidates: [],
          loading: false,
          busy: false,
          error: "The place search is busy. Try again in a few seconds.",
        });
      } else {
        setState({ candidates: [], loading: false, busy: false, error: res.error });
      }
    };

    timer = setTimeout(run, GEOCODE_DEBOUNCE_MS);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [q]);

  return state;
}
