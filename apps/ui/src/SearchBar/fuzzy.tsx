/**
 * The typeahead scorer + match highlighter shared by the map `SearchBar` and
 * the Cmd+K `CommandPalette`. Extracted verbatim from `SearchBar/index.tsx`
 * so both surfaces rank and highlight results identically instead of growing
 * two subtly different fuzzy matchers.
 */

export interface Match {
  score: number;
  positions: number[];
}

/**
 * Score `name` against query `q`, returning the matched character positions or
 * `null` when it doesn't match at all. Tiers (best first): exact, prefix,
 * word-boundary, substring, in-order fuzzy.
 */
export function score(name: string, q: string): Match | null {
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

/** Renders `text` with the matched `positions` emphasized. */
export function Highlight({ text, positions }: { text: string; positions: number[] }) {
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
