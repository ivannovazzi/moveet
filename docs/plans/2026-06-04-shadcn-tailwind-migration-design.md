# shadcn/ui + Tailwind Migration — Design

**Date:** 2026-06-04
**Branch:** `feat/shadcn-tailwind-migration`
**App:** `apps/ui`

## Goal

Migrate the `apps/ui` dashboard from hand-rolled CSS Modules + react-aria-components
to **shadcn/ui** (Radix primitives + Tailwind v4 + copy-owned components).

### Decisions (from brainstorming)

- **Styling target:** Full Tailwind. Convert all CSS Modules to utility classes; no
  CSS Modules remain at the end.
- **Sequencing:** Big-bang rewrite on one branch, landed as a sequence of green commits.
- **Aesthetic:** Fresh shadcn design language (not a pixel-port of the current look).
- **Theme:** Dark-only. No light palette, no theme toggle.

## Current state

- React 19.2, Vite 8, TypeScript 6, ESLint 10, Vitest 4.
- **68 component files**, **30 CSS Modules**, **65 test files / 621 tests** (baseline green).
- `react-aria-components` 1.16 used in 17 files. Primitives in use: Button, ComboBox,
  Input, Label, ListBox, Popover, SearchField, Select, Slider, Switch, TextField.
- Three zones: `Controls/` (21), `components/` (21), `Map/` (20, mostly deck.gl layers).
- Map renderer is deck.gl + luma.gl — **not** part of this migration (logic, not chrome).

## Section 1 — Tooling foundation

- **Tailwind v4** via `@tailwindcss/vite` (no `tailwind.config.js`, no PostCSS). Config is
  CSS-first: a single `@theme { }` block in `src/index.css`.
- **shadcn CLI** (latest, React 19 + Vite support) writes primitives into `src/components/ui/`.
  Existing `src/components/` keeps custom code.
- **Remove:** `the-new-css-reset`, `classnames` (→ `cn()` = `clsx` + `tailwind-merge`),
  `sass-embedded`, and eventually `react-aria-components` (Radix replaces it).
- **Add:** `tailwindcss`, `@tailwindcss/vite`, `clsx`, `tailwind-merge`, `lucide-react`,
  `class-variance-authority`.
- deck.gl, luma.gl, vitest, testing-library untouched.

## Section 2 — Component mapping

| Current (react-aria)            | shadcn component             | Used in                     |
| ------------------------------- | ---------------------------- | --------------------------- |
| `Button` / `AriaButton`         | `Button` (CVA variants)      | everywhere                  |
| `Switch`                        | `Switch`                     | TogglesPanel                |
| `Slider`                        | `Slider`                     | SpeedPanel, ClockPanel      |
| `Select` / `ListBox`            | `Select`                     | Fleets, ConfigForm          |
| `ComboBox`                      | `Combobox` (Command+Popover) | SearchBar                   |
| `SearchField`                   | `Input` + lucide icon        | SearchBar                   |
| `TextField` / `Input` / `Label` | `Input` + `Label`            | ConfigForm, forms           |
| `Popover`                       | `Popover`                    | ContextMenu, MapContextMenu |

Hand-built → shadcn:

- `AdapterDrawer` → `Sheet`
- `PanelShell`/`PanelHeader`/`PanelBody` → `Card` + composition (or thin Tailwind wrappers)
- `Toast` → `Sonner`
- `Icons.tsx` → `lucide-react` (delete custom SVGs)
- Source/Sinks/Realism tabs → `Tabs`
- `BottomDock`, `IconRail` → Tailwind layout, no library

a11y note: Radix replaces react-aria's focus/a11y guarantees with equivalents — no regression,
but eyeball ComboBox/Select/Slider keyboard behavior manually.

## Section 3 — Fresh aesthetic & theming

- **Base color:** `slate` or `zinc` (neutral, data-friendly). **Dark default** — set
  `<html class="dark">` permanently; drop the light `:root` palette.
- **Semantic status tokens** on top of shadcn palette: `--status-ok`, `--status-warn`,
  `--status-error`, `--status-idle`. Kept decoupled from deck.gl color ramps (data-driven, in JS).
- **Density:** dial up slightly for an ops UI — smaller paddings, `--radius: 0.5rem`.
- **Typography:** shadcn `font-sans`, `text-sm` baseline for controls.
- Map chrome (panels, rail, dock, search) gets the theme; the deck.gl canvas does not.

## Section 4 — Map boundary

- **Stays (logic):** deck.gl layers + controllers — `Vehicle`, `POI`, `Geofence`,
  `Breadcrumb`, providers/hooks under `components/Map/`. ~8 files left alone.
- **Migrates (chrome over canvas):** `Zoom`, `SearchBar`, `MapContextMenu`/`ContextMenu`,
  `ConnectionStatus`, `LoadingOverlay`, map-anchored tooltips/popovers. ~12 files.
- **Seam:** overlay layering/DOM structure unchanged; only styling moves from CSS Modules
  to Tailwind utilities (`absolute top-4 right-4 z-10 …`).
- **deck.gl `getTooltip`** returns imperative HTML outside React — can't take Tailwind
  classes. Keep inline styles or replace with React-rendered shadcn popovers case-by-case.

## Section 5 — Testing strategy

- **Breaks:** tests querying react-aria's DOM/roles for Switch/Select/ComboBox/Slider —
  Radix emits different markup/ARIA. Structural queries break; behavioral assertions survive.
- **Safe:** store-state, handler-call, data-formatting, and Map-logic tests.
- **Approach:** convert each component and fix its test in the same commit. Prefer
  role/accessible-name queries (`getByRole('switch', { name })`) over class/structure queries —
  resilient across the swap and the correct cleanup anyway.
- **Icons:** rewrite/remove `Icons`-markup assertions against lucide's `aria-hidden` icons.
- Expect to touch ~15–20 of the test files; Map-logic tests largely untouched.
- **Guardrail:** keep `vitest run` green per zone.

## Section 6 — Execution & risks

Staged commits on the branch (each green):

1. **Foundation** — add Tailwind v4 + plugin, init shadcn, `@theme` tokens + dark palette,
   swap `index.css`, drop css-reset/classnames/sass. App still renders (CSS Modules coexist temporarily).
2. **Primitives** — generate `ui/` components; rebuild `PanelPrimitives`/`Card`, `Button`,
   `Toast→Sonner`, `Icons→lucide`. Fix their tests.
3. **Controls zone** (21 files) — panels, drawers→`Sheet`, tabs, sliders, switches. Delete each
   `.module.css`. Fix tests.
4. **components + overlays** — ContextMenu, ConnectionStatus, LoadingOverlay,
   SearchBar→`Combobox`, Zoom.
5. **Cleanup** — remove `react-aria-components`, delete dead CSS Modules, `the-new-css-reset`,
   sass; run full `vitest` + `tsc -b` + `eslint`.

**Risks / watch-items:**

- react-aria → Radix behavior drift on ComboBox/Select/Slider — manual keyboard/focus check.
- deck.gl imperative tooltips can't take Tailwind classes — decide keep-inline vs React-popover per case.
- Tailwind v4 + Vite 8 + React 19 is recent; if shadcn CLI hiccups on Vite 8, fall back to manual component copy.
- Diff size — 68 components touched; staged commits keep review sane.
- No visual regression net (fresh aesthetic) — rely on manual review + Chrome DevTools pass per zone.
