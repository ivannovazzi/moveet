import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * deck.gl silently ignores `outlineWidth` / `outlineColor` on a TextLayer whose
 * font atlas is not SDF, and logs "fontSettings.sdf is required to render
 * outline". Three layers shipped that way (geofence labels, road labels, POI
 * labels) before anyone noticed the outlines were simply absent.
 *
 * This is a source guard rather than a props assertion: the layers live behind
 * map context and a RAF loop, so mounting each one to inspect its props costs
 * far more than it catches. Instead, every source file that asks for an
 * outline must also opt into SDF and size the atlas to fit the halo.
 *
 * Those settings now live in one place (`src/lib/mapLabels.ts`), which is why
 * `src/lib` is scanned alongside the map directories — the second test below
 * makes sure no map file goes back to hand-rolling its own label style.
 *
 * The check is file-scoped, so it would miss a file with two TextLayers where
 * only one is SDF. That is an accepted limitation — the failure it does catch
 * (an outline that renders as nothing) is the one that actually shipped.
 */

const MAP_DIRS = ["src/Map", "src/components/Map"];
const LABEL_DIRS = [...MAP_DIRS, "src/lib"];

function collectSourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectSourceFiles(full);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

function read(dirs: string[]) {
  return dirs
    .flatMap((dir) => collectSourceFiles(dir))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

const withOutline = read(LABEL_DIRS).filter(({ text }) => text.includes("outlineWidth"));
const mapSources = read(MAP_DIRS);

describe("map text layer outlines", () => {
  it("finds the code that requests an outline", () => {
    // Guards the guard: if the shared style moves or gets renamed, this test
    // should start failing rather than silently checking an empty set.
    expect(withOutline.length).toBeGreaterThanOrEqual(1);
    expect(withOutline.some(({ path }) => path.endsWith("mapLabels.ts"))).toBe(true);
  });

  it("routes every map text layer through the shared label style", () => {
    // One voice for map labels: a layer that builds its own TextLayer without
    // mapLabelProps() would drift on font, weight, or halo — which is how job
    // and dispatch labels ended up with no halo at all.
    const offenders = mapSources
      .filter(({ text }) => text.includes("new TextLayer"))
      .filter(({ text }) => !text.includes("mapLabelProps("))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("never hands the canvas the CSS keyword `inherit` as a font family", () => {
    // deck.gl builds the SDF glyph atlas with `ctx.font = "600 64px <family>"`.
    // `inherit` is not a valid font shorthand, so the canvas keeps its 10px
    // sans-serif default and every glyph rasterises tiny, then scales to
    // getSize — labels shipped as ~2px dashes at every zoom because of it.
    const offenders = read(LABEL_DIRS)
      .filter(({ text }) => /fontFamily:\s*["'`]inherit["'`]/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it.each(withOutline.map(({ path }) => path))("%s opts into an SDF atlas", (path) => {
    const { text } = withOutline.find((s) => s.path === path)!;
    expect(text).toMatch(/sdf:\s*true/);
  });

  it.each(withOutline.map(({ path }) => path))(
    "%s sizes the atlas to fit the halo it asks for",
    (path) => {
      const { text } = withOutline.find((s) => s.path === path)!;
      const outlineWidth = Number(text.match(/outlineWidth:\s*([\d.]+)/)?.[1]);
      const radius = Number(text.match(/radius:\s*([\d.]+)/)?.[1]);
      const buffer = Number(text.match(/buffer:\s*([\d.]+)/)?.[1]);

      expect(Number.isFinite(outlineWidth)).toBe(true);
      expect(Number.isFinite(radius)).toBe(true);
      expect(Number.isFinite(buffer)).toBe(true);

      // Above `radius`, deck.gl clamps and the halo stops growing.
      expect(outlineWidth).toBeLessThanOrEqual(radius);
      // The halo occupies 0.75 * outlineWidth atlas px; `buffer` is the glyph's
      // padding in the atlas, so anything smaller clips it.
      expect(buffer).toBeGreaterThanOrEqual(0.75 * outlineWidth);
    }
  );
});
