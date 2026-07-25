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
 * far more than it catches. Instead, every map source file that asks for an
 * outline must also opt into SDF and size the atlas to fit the halo.
 *
 * The check is file-scoped, so it would miss a file with two TextLayers where
 * only one is SDF. That is an accepted limitation — today no map file has more
 * than one text layer, and the failure it does catch (an outline that renders
 * as nothing) is the one that actually shipped.
 */

const MAP_DIRS = ["src/Map", "src/components/Map"];

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

const sources = MAP_DIRS.flatMap((dir) => collectSourceFiles(dir)).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

const withOutline = sources.filter(({ text }) => text.includes("outlineWidth"));

describe("map text layer outlines", () => {
  it("finds the layers that request an outline", () => {
    // Guards the guard: if the layers move or get renamed, this test should
    // start failing rather than silently checking an empty set.
    expect(withOutline.length).toBeGreaterThanOrEqual(3);
  });

  it.each(withOutline.map(({ path }) => path))("%s opts into an SDF atlas", (path) => {
    const { text } = withOutline.find((s) => s.path === path)!;
    expect(text).toMatch(/sdf:\s*true/);
  });

  it.each(
    withOutline.map(({ path }) => path)
  )("%s sizes the atlas to fit the halo it asks for", (path) => {
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
  });
});
