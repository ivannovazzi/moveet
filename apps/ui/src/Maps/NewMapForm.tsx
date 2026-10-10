import { useEffect, useId, useRef, useState } from "react";
import { Button, Switch } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import { Eyebrow, mono } from "@/Dock/DockPanelKit";
import { cn } from "@/lib/utils";
import {
  clearAreaDraft,
  previewArea,
  selectArea,
  setResolvedExtract,
  useAreaDraft,
} from "./areaDraft";
import { bboxAreaKm2, bboxProblem, formatArea, formatBytes, shrinkToArea } from "./bbox";
import {
  findGeofabrik,
  geocode,
  type Bbox,
  type GeocodeResult,
  type GeofabrikRegion,
  type MapLibrary,
} from "./mapsClient";
import { startBuild } from "./mapsStore";

/** Wait this long after the last keystroke before asking the geocoder. */
export const GEOCODE_DEBOUNCE_MS = 400;
/** After a 429, try the same query again this much later. */
export const GEOCODE_RETRY_MS = 1500;
/** A download this big (a whole country or continent) gets a warning. */
export const LARGE_DOWNLOAD_BYTES = 1024 ** 3;
/** When the extract's size has not arrived yet, look the box up again this much later. */
const SIZE_RETRY_MS = 4000;
const MIN_QUERY = 2;
const MAX_LABEL = 64;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";

const OPTION_ROW = cn(
  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast ease-standard hover:bg-foreground/[0.04]",
  "aria-pressed:bg-accent/12 aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent)]",
  FOCUS_RING
);

/**
 * The New map flow, beside the area picker's world map: search a place, see
 * it on the map as the results come in, pick one, and build. The box is the
 * place's extent, trimmed to the server's area cap when it is larger, and can
 * be adjusted on the map (never past the cap). The map covers exactly that box;
 * the Geofabrik extract it is cut from is picked automatically.
 */
export default function NewMapForm({
  library,
  onClose,
}: {
  library: MapLibrary | null;
  onClose: () => void;
}) {
  const draft = useAreaDraft();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<GeocodeResult | null>(null);
  const [trimmed, setTrimmed] = useState(false);
  const [label, setLabel] = useState("");
  const [labelEdited, setLabelEdited] = useState(false);
  const [buildings, setBuildings] = useState(true);
  const [activateWhenDone, setActivateWhenDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const ids = { query: useId(), label: useId(), buildings: useId(), activate: useId() };
  const search = useGeocode(query);
  const maxArea = library?.builds?.limits.maxAreaKm2 ?? null;

  // The area belongs to this form: drop it when the form goes away.
  useEffect(() => () => clearAreaDraft(), []);

  // Live: the top result shows on the map as soon as it arrives.
  const top = search.results[0] ?? null;
  const topKey = top ? `${top.name}|${top.bbox.join(",")}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the top result, by value.
  useEffect(() => {
    if (top && !picked) previewArea({ bbox: top.bbox, outline: top.outline });
  }, [topKey]);

  const pick = (c: GeocodeResult) => {
    const fits = maxArea === null || bboxAreaKm2(c.bbox) <= maxArea;
    selectArea(fits || maxArea === null ? c.bbox : shrinkToArea(c.bbox, maxArea), c.outline);
    setPicked(c);
    setTrimmed(!fits);
    setSubmitError(null);
    if (!labelEdited) setLabel(c.name.split(",")[0].trim().slice(0, MAX_LABEL));
  };

  // ── Checks ─────────────────────────────────────────────────────────
  const bbox = draft.bbox;
  const area = bbox ? bboxAreaKm2(bbox) : null;
  const shapeProblem = bbox ? bboxProblem(bbox) : null;
  const lookup = useGeofabrikLookup(bbox && !shapeProblem ? bbox : null);
  // The smallest extract that holds the whole box.
  const region = lookup.regions?.[0] ?? null;

  useEffect(() => {
    setResolvedExtract({ selected: bbox ? (region?.path ?? null) : null });
  }, [bbox, region?.path]);

  const trimmedLabel = label.trim();
  const problems: string[] = [];
  if (shapeProblem) problems.push(shapeProblem);
  if (bbox && !shapeProblem) {
    if (lookup.loading) problems.push("Finding the extract to download.");
    else if (lookup.error) problems.push(`Could not find a source extract: ${lookup.error}`);
    else if (!region) {
      problems.push(
        lookup.crosses.length > 1
          ? `No Geofabrik extract covers this area: it spans ${namesOf(lookup.crosses)}, which share no extract. Adjust the box so it stays within one of them.`
          : "No Geofabrik extract covers this area."
      );
    }
  }
  if (bbox && !trimmedLabel) problems.push("Give the map a name.");
  const canBuild = bbox !== null && problems.length === 0 && !submitting;

  const submit = async () => {
    if (!canBuild || !bbox || !region) return;
    setSubmitting(true);
    setSubmitError(null);
    // Exactly the box on the map; the extract is only what it is cut from.
    const res = await startBuild({
      label: trimmedLabel,
      bbox,
      geofabrik: region.path,
      buildings,
      activate: activateWhenDone,
    });
    setSubmitting(false);
    if (res.ok) onClose();
    else setSubmitError(res.error);
  };

  return (
    <form
      aria-label="New map"
      className="flex flex-col gap-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-[15px]">
        <Eyebrow>New map</Eyebrow>
        <Button size="xs" variant="ghost" type="button" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 px-[15px]">
        <label htmlFor={ids.query} className="flex flex-col gap-1 text-micro text-muted-foreground">
          Place
          <Input
            id={ids.query}
            type="search"
            value={query}
            autoComplete="off"
            autoFocus
            placeholder="City, town or district"
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
          />
        </label>
        <div
          role="status"
          aria-live="polite"
          className="text-micro text-muted-foreground empty:hidden"
        >
          {search.loading
            ? "Searching…"
            : search.busy
              ? "The place search is busy. Trying again in a moment."
              : ""}
        </div>
        {search.error && <p className="text-micro text-status-error">{search.error}</p>}
        {search.results.length > 0 && (
          <ul
            aria-label="Places"
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto"
            onMouseLeave={() =>
              !picked && top && previewArea({ bbox: top.bbox, outline: top.outline }, false)
            }
          >
            {search.results.map((c) => (
              <li key={`${c.name}|${c.bbox.join(",")}`}>
                <button
                  type="button"
                  aria-pressed={picked === c}
                  onClick={() => pick(c)}
                  onMouseEnter={() => !picked && previewArea({ bbox: c.bbox, outline: c.outline })}
                  onFocus={() => !picked && previewArea({ bbox: c.bbox, outline: c.outline })}
                  className={OPTION_ROW}
                >
                  <span className="line-clamp-2 text-label text-foreground">{c.name}</span>
                  <span className={cn(mono, "text-micro text-muted-foreground/70")}>
                    {formatArea(bboxAreaKm2(c.bbox))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!search.loading &&
          !search.busy &&
          !search.error &&
          query.trim().length >= MIN_QUERY &&
          search.results.length === 0 && (
            <p className="text-micro text-muted-foreground">No places found.</p>
          )}
        {search.attribution && search.results.length > 0 && (
          <p className="text-micro text-muted-foreground/60">{search.attribution}</p>
        )}
      </div>

      {bbox && (
        <div className="mx-[15px] flex flex-col gap-1.5 rounded-md border border-border-soft px-3 py-2 text-meta">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Area</dt>
            <dd className={mono}>
              {area !== null ? formatArea(area) : "?"}
              {maxArea !== null && (
                <span className="text-muted-foreground"> of {formatArea(maxArea)} max</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Download</dt>
            <dd className="min-w-0">
              <SourceText region={region} loading={lookup.loading} />
            </dd>
          </dl>
          {trimmed && maxArea !== null && (
            <p className="text-micro leading-snug text-muted-foreground">
              {picked?.name.split(",")[0] ?? "The place"} is larger than the {formatArea(maxArea)}{" "}
              limit, so the box is trimmed around its centre.
            </p>
          )}
          {region && lookup.crosses.length > 1 && (
            <p className="text-micro leading-snug text-muted-foreground">
              The box crosses from {namesOf(lookup.crosses)}, so the whole of {region.name} is
              downloaded.
            </p>
          )}
          {region?.sizeBytes !== undefined && region.sizeBytes >= LARGE_DOWNLOAD_BYTES && (
            <p className="text-micro leading-snug text-status-warn">
              That is a large download. It is cached for later builds; the map itself only covers
              the box.
            </p>
          )}
          <p className="text-micro leading-snug text-muted-foreground/70">
            Drag the box's corners or edges on the map to adjust it.
          </p>
        </div>
      )}

      {bbox && (
        <div className="flex flex-col gap-2.5 px-[15px]">
          <label
            htmlFor={ids.label}
            className="flex flex-col gap-1 text-micro text-muted-foreground"
          >
            Name
            <Input
              id={ids.label}
              value={label}
              maxLength={MAX_LABEL}
              placeholder="e.g. Lisbon centre"
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
            <Switch
              id={ids.activate}
              isSelected={activateWhenDone}
              onChange={setActivateWhenDone}
            />
            Switch to it when done
          </label>
        </div>
      )}

      {problems.length > 0 && (
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

function namesOf(regions: { name: string }[]): string {
  const names = regions.map((r) => r.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} into ${names[names.length - 1]}`;
}

function SourceText({ region, loading }: { region: GeofabrikRegion | null; loading: boolean }) {
  if (loading) return <span className="text-muted-foreground">Finding…</span>;
  if (!region) return <span className="text-status-error">No extract covers it</span>;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" title={region.path}>
      <span className="truncate">{region.name}</span>
      {region.sizeBytes !== undefined && (
        <span
          className={cn(
            mono,
            "shrink-0 text-micro",
            region.sizeBytes >= LARGE_DOWNLOAD_BYTES ? "text-status-warn" : "text-muted-foreground"
          )}
        >
          {formatBytes(region.sizeBytes)}
        </span>
      )}
    </span>
  );
}

// ─── Lookups ─────────────────────────────────────────────────────────

interface GeofabrikLookup {
  regions: GeofabrikRegion[] | null;
  /** The extracts the box straddles, when it crosses a border. */
  crosses: { path: string; name: string }[];
  loading: boolean;
  error: string | null;
}

const NO_CROSSES: GeofabrikLookup["crosses"] = [];

/** The Geofabrik extracts that contain `bbox`, smallest first. */
function useGeofabrikLookup(bbox: Bbox | null): GeofabrikLookup {
  const key = bbox?.join(",") ?? null;
  const [result, setResult] = useState<GeofabrikLookup & { key: string | null }>({
    key: null,
    regions: null,
    crosses: NO_CROSSES,
    loading: false,
    error: null,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the box, by value.
  useEffect(() => {
    if (!bbox || !key) return;
    const ac = new AbortController();
    let sizeRetry: ReturnType<typeof setTimeout> | undefined;
    const ask = (quiet: boolean) => {
      if (!quiet) {
        setResult({ key, regions: null, crosses: NO_CROSSES, loading: true, error: null });
      }
      findGeofabrik(bbox, ac.signal).then((res) => {
        if (ac.signal.aborted || (quiet && !res.ok)) return;
        setResult(
          res.ok
            ? {
                key,
                regions: res.data.regions,
                crosses: res.data.crosses ?? NO_CROSSES,
                loading: false,
                error: null,
              }
            : { key, regions: null, crosses: NO_CROSSES, loading: false, error: res.error }
        );
        // The server answers before a slow download size arrives: ask once more.
        if (
          !quiet &&
          res.ok &&
          res.data.regions[0] &&
          res.data.regions[0].sizeBytes === undefined
        ) {
          sizeRetry = setTimeout(() => ask(true), SIZE_RETRY_MS);
        }
      });
    };
    // A box dragged on the map changes on every frame: look it up once it rests.
    const timer = setTimeout(() => ask(false), 150);
    return () => {
      ac.abort();
      clearTimeout(timer);
      clearTimeout(sizeRetry);
    };
  }, [key]);

  if (!key || result.key !== key) {
    return { regions: null, crosses: NO_CROSSES, loading: key !== null, error: null };
  }
  return result;
}

interface GeocodeState {
  results: GeocodeResult[];
  loading: boolean;
  /** Rate limited: a retry is scheduled. */
  busy: boolean;
  error: string | null;
  attribution?: string;
}

/** Debounced place search. A 429 is retried once, quietly, after a pause. */
function useGeocode(query: string): GeocodeState {
  const [state, setState] = useState<GeocodeState>({
    results: [],
    loading: false,
    busy: false,
    error: null,
  });
  const q = query.trim();
  const retried = useRef(false);

  useEffect(() => {
    retried.current = false;
    if (q.length < MIN_QUERY) {
      setState({ results: [], loading: false, busy: false, error: null });
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
          results: res.data.results,
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
          results: [],
          loading: false,
          busy: false,
          error: "The place search is busy. Try again in a few seconds.",
        });
      } else {
        setState({ results: [], loading: false, busy: false, error: res.error });
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
