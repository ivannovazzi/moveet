/**
 * Data credits for the map.
 *
 * The road network and POIs come from OpenStreetMap extracts, and the ODbL
 * requires a visible credit wherever that data is shown. Another source (a
 * buildings dataset, say) is credited by appending one entry to `CREDITS`.
 */
export interface Credit {
  /** Stable key for the entry. */
  id: string;
  label: string;
  href: string;
}

export const CREDITS: readonly Credit[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    href: "https://www.openstreetmap.org/copyright",
  },
];

export interface AttributionProps {
  credits?: readonly Credit[];
}

export default function Attribution({ credits = CREDITS }: AttributionProps) {
  if (credits.length === 0) return null;

  return (
    <div
      data-testid="map-attribution"
      // Click-through box: only the links take the pointer, so the map stays
      // draggable right up to the text.
      className="pointer-events-none rounded-md border border-border surface-glass glass-frost px-2 py-1 text-micro text-muted-foreground shadow-elevated"
    >
      {"© "}
      {credits.map((credit, i) => (
        <span key={credit.id}>
          {i > 0 && ", "}
          <a
            href={credit.href}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
          >
            {credit.label}
          </a>
        </span>
      ))}
      {" contributors"}
    </div>
  );
}
