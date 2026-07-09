import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Command, CommandItem, CommandList } from "cmdk";
import type { POI, Road } from "@/types";
import { Directions, POI as POIIcon, Road as RoadIcon } from "@/components/Icons";
import { Button } from "@/components/Inputs";
import { useRoads } from "@/hooks/useRoads";
import { usePois } from "@/hooks/usePois";
import { isRoad } from "@/utils/typeGuards";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 12;

// ── Fuzzy search ──────────────────────────────────────────────────────────────

interface Match {
  score: number;
  positions: number[];
}

function score(name: string, q: string): Match | null {
  const n = name.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return null;

  // Exact
  if (n === query)
    return {
      score: 1000,
      positions: Array.from({ length: query.length }, (_, i) => i),
    };

  // Starts with
  if (n.startsWith(query)) {
    return {
      score: 800,
      positions: Array.from({ length: query.length }, (_, i) => i),
    };
  }

  // Word boundary start
  const wordMatch = n.match(
    new RegExp(`(^|\\s|-)(?=${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
  );
  if (wordMatch !== null && wordMatch.index !== undefined) {
    const start = wordMatch.index + wordMatch[1].length;
    return {
      score: 700 - start,
      positions: Array.from({ length: query.length }, (_, i) => start + i),
    };
  }

  // Contains
  const idx = n.indexOf(query);
  if (idx !== -1) {
    return {
      score: 500 - idx,
      positions: Array.from({ length: query.length }, (_, i) => idx + i),
    };
  }

  // Fuzzy (chars in order)
  const pos: number[] = [];
  let qi = 0;
  for (let i = 0; i < n.length && qi < query.length; i++) {
    if (n[i] === query[qi]) {
      pos.push(i);
      qi++;
    }
  }
  if (qi === query.length) {
    const spread = pos[pos.length - 1] - pos[0] + 1;
    const coverage = query.length / spread;
    const consecutiveBonus = pos.reduce(
      (acc, p, i) => acc + (i > 0 && p === pos[i - 1] + 1 ? 10 : 0),
      0
    );
    return {
      score: 200 * coverage + consecutiveBonus - pos[0],
      positions: pos,
    };
  }

  return null;
}

interface Result {
  item: Road | POI;
  score: number;
  positions: number[];
}

function fuzzySearch(roads: Road[], pois: POI[], query: string): Result[] {
  if (!query.trim()) return [];
  const results: Result[] = [];

  for (const r of roads) {
    if (!r.name) continue;
    const m = score(r.name, query);
    if (m) results.push({ item: r, score: m.score, positions: m.positions });
  }
  for (const p of pois) {
    if (!p.name) continue;
    const m = score(p.name, query);
    if (m) results.push({ item: p, score: m.score, positions: m.positions });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

// ── Highlight ─────────────────────────────────────────────────────────────────

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;

  const set = new Set(positions);
  const parts: { t: string; hl: boolean }[] = [];
  let cur = "";
  let curHl = set.has(0);

  for (let i = 0; i < text.length; i++) {
    const hl = set.has(i);
    if (hl !== curHl) {
      if (cur) parts.push({ t: cur, hl: curHl });
      cur = text[i];
      curHl = hl;
    } else {
      cur += text[i];
    }
  }
  if (cur) parts.push({ t: cur, hl: curHl });

  return (
    <>
      {parts.map((p, i) =>
        p.hl ? (
          <mark key={i} className="bg-transparent font-semibold text-accent">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  );
}

// ── SearchBar ─────────────────────────────────────────────────────────────────

interface SearchBarProps {
  selectedItem: Road | POI | null;
  onDestinationClick: () => void;
  onItemSelect: (item: Road | POI) => void;
  onItemUnselect: () => void;
}

export default function SearchBar({
  selectedItem,
  onDestinationClick,
  onItemSelect,
}: SearchBarProps) {
  const { roads } = useRoads();
  const { pois } = usePois();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => fuzzySearch(roads, pois, query), [roads, pois, query]);
  const showResults = open && results.length > 0;

  useEffect(() => setActiveIdx(0), [results]);

  const commit = useCallback(
    (item: Road | POI) => {
      onItemSelect(item);
      setQuery(item.name ?? "");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onItemSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (!query) inputRef.current?.blur();
        return;
      }
      if (!showResults) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Stop cmdk's Command root from also moving its internal selection —
        // navigation is driven solely by `activeIdx`.
        e.stopPropagation();
        setActiveIdx((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const r = results[activeIdx];
        if (r) commit(r.item);
      }
    },
    [showResults, results, activeIdx, commit, query]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-auto absolute left-1/2 top-4 z-50 flex w-[min(640px,calc(100%-72px))]",
        "-translate-x-1/2 flex-col overflow-hidden border border-border surface-glass shadow-floating backdrop-blur-md",
        "rounded-lg"
      )}
      role="combobox"
      aria-expanded={showResults}
      aria-haspopup="listbox"
    >
      <Command
        shouldFilter={false}
        className="flex flex-col bg-transparent text-popover-foreground"
      >
        {/* ── Input row ── */}
        <div className={cn("flex h-12 items-stretch", showResults && "border-b border-border")}>
          <div className="relative flex min-w-0 flex-1 items-center">
            <svg
              className="pointer-events-none absolute left-4 size-4 shrink-0 text-muted-foreground"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M10 10L14 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              className="h-full w-full bg-transparent pl-11 pr-7 text-sm text-foreground caret-accent outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (query) setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search roads and places…"
              aria-label="Search"
              aria-autocomplete="list"
              aria-controls="search-results"
              aria-activedescendant={showResults ? `result-${activeIdx}` : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                className="absolute right-4 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 p-0 text-muted-foreground transition-colors hover:bg-foreground/20 hover:text-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery("");
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                tabIndex={-1}
                aria-label="Clear"
              >
                <svg className="size-2 fill-none" viewBox="0 0 12 12">
                  <path
                    d="M2 2l8 8M10 2l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            onClick={onDestinationClick}
            isDisabled={!selectedItem}
            className="h-full w-14 shrink-0 rounded-none border-0 border-l border-border text-muted-foreground hover:text-foreground [&_svg]:size-[18px]"
            aria-label="Get directions"
          >
            <Directions />
          </Button>
        </div>

        {/* ── Results ── */}
        {showResults && (
          <CommandList
            id="search-results"
            className="max-h-[380px] origin-top animate-scale-in overflow-y-auto p-2"
            aria-label="Search results"
          >
            {results.map((r, i) => {
              const road = isRoad(r.item);
              return (
                <CommandItem
                  key={`${r.item.name}-${i}`}
                  id={`result-${i}`}
                  value={`${r.item.name ?? ""}-${i}`}
                  className={cn(
                    "flex min-h-9 cursor-pointer select-none items-center gap-3 rounded-sm px-4 py-2 text-foreground transition-colors duration-fast ease-standard",
                    i === activeIdx && "bg-accent/10"
                  )}
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(r.item);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  onSelect={() => commit(r.item)}
                >
                  <span
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-fast ease-standard [&_svg]:size-3.5",
                      i === activeIdx && "text-accent"
                    )}
                  >
                    {road ? <RoadIcon /> : <POIIcon />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm leading-tight text-muted-foreground">
                    <Highlight text={r.item.name ?? ""} positions={r.positions} />
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground opacity-70",
                      i === activeIdx && "text-accent opacity-100"
                    )}
                  >
                    {road ? "road" : "place"}
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        )}
      </Command>
    </div>
  );
}
