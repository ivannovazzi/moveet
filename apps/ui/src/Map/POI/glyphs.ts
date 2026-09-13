/**
 * Vendored glyph geometry for the nine POI group icons.
 *
 * Source: lucide (https://lucide.dev), ISC licence. Each entry is the icon's
 * `__iconData.node` copied verbatim from
 * node_modules/lucide-react/dist/esm/icons/<name>.mjs, minus React's `key`
 * attribute, which is reconciliation bookkeeping rather than geometry.
 *
 * Why a copy rather than the components: the atlas rasterises these onto a
 * canvas at module load, and reading a lucide component's geometry means
 * rendering it to markup and parsing it back, which drags React's server
 * renderer into the browser bundle to read fifty numbers. The shapes are stable artwork, so
 * they live here as data. To refresh one, re-copy `__iconData.node` from the
 * file named beside its group below.
 */

import type { PoiGroup } from "./categories";

/** An SVG element as lucide stores it: `[tag, attributes]`. */
export type IconNode = readonly [tag: string, attrs: Record<string, string>][];

export const POI_GLYPHS: Record<PoiGroup, IconNode> = {
  // lucide `bus`
  transit: [
    ["path", { d: "M8 6v6" }],
    ["path", { d: "M15 6v6" }],
    ["path", { d: "M2 12h19.6" }],
    [
      "path",
      {
        d: "M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3",
      },
    ],
    ["circle", { cx: "7", cy: "18", r: "2" }],
    ["path", { d: "M9 18h5" }],
    ["circle", { cx: "16", cy: "18", r: "2" }],
  ],
  // lucide `shopping-bag`
  shop: [
    ["path", { d: "M16 10a4 4 0 0 1-8 0" }],
    ["path", { d: "M3.103 6.034h17.794" }],
    [
      "path",
      {
        d: "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z",
      },
    ],
  ],
  // lucide `utensils`
  food: [
    ["path", { d: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" }],
    ["path", { d: "M7 2v20" }],
    ["path", { d: "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" }],
  ],
  // lucide `heart-pulse`
  health: [
    [
      "path",
      {
        d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
      },
    ],
    ["path", { d: "M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" }],
  ],
  // lucide `graduation-cap`
  education: [
    [
      "path",
      {
        d: "M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z",
      },
    ],
    ["path", { d: "M22 10v6" }],
    ["path", { d: "M6 12.5V16a6 3 0 0 0 12 0v-3.5" }],
  ],
  // lucide `landmark`
  civic: [
    ["path", { d: "M10 18v-7" }],
    [
      "path",
      {
        d: "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z",
      },
    ],
    ["path", { d: "M14 18v-7" }],
    ["path", { d: "M18 18v-7" }],
    ["path", { d: "M3 22h18" }],
    ["path", { d: "M6 18v-7" }],
  ],
  // lucide `church`
  worship: [
    ["path", { d: "M10 9h4" }],
    ["path", { d: "M12 7v5" }],
    ["path", { d: "M14 21v-3a2 2 0 0 0-4 0v3" }],
    [
      "path",
      {
        d: "m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9",
      },
    ],
    [
      "path",
      { d: "M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14" },
    ],
  ],
  // lucide `ticket`
  leisure: [
    [
      "path",
      {
        d: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
      },
    ],
    ["path", { d: "M13 5v2" }],
    ["path", { d: "M13 17v2" }],
    ["path", { d: "M13 11v2" }],
  ],
  // lucide `fuel`
  fuel: [
    ["path", { d: "M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5" }],
    ["path", { d: "M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" }],
    ["path", { d: "M2 21h13" }],
    ["path", { d: "M3 9h11" }],
  ],
};
