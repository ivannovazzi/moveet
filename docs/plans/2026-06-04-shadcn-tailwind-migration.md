# shadcn/ui + Tailwind Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `apps/ui`'s CSS Modules + react-aria-components UI layer with shadcn/ui (Radix + Tailwind v4 + owned components), dark-only, fresh aesthetic, in one branch landed as green commits.

**Architecture:** Tailwind v4 via `@tailwindcss/vite` (CSS-first config, no JS config file). shadcn primitives live in `src/components/ui/`. The existing `src/components/Inputs/` wrappers are rebuilt on shadcn first — they funnel most react-aria usage, so 11 consumers migrate for free. CSS Modules are converted to utility classes per zone and deleted. deck.gl/luma.gl map rendering is out of scope; only map _chrome_ (overlays) migrates.

**Tech Stack:** React 19.2, Vite 8, TypeScript 6, Tailwind v4, shadcn/ui, Radix UI, lucide-react, class-variance-authority, clsx + tailwind-merge, Vitest 4, Testing Library.

**Working directory:** `apps/ui` inside worktree `.worktrees/shadcn-migration` (branch `feat/shadcn-tailwind-migration`).

**Baseline:** 65 test files / 621 tests passing. Every phase must end green: `npx vitest run` + `npx tsc -b --noEmit` + `npx eslint .`.

**Design doc:** `docs/plans/2026-06-04-shadcn-tailwind-migration-design.md`

---

## How to test a styling migration

Most of these tasks aren't new-behavior TDD — they're "swap the implementation, keep behavior identical." The test discipline is:

1. **Before touching a component, run its existing test** so you know it's green.
2. Prefer **role/accessible-name queries** when fixing tests (`getByRole('switch', { name })`) — resilient across react-aria→Radix.
3. After conversion, run that component's test. If it fails on _structure_ (class names, DOM shape), fix the test. If it fails on _behavior_ (handler not called), fix the component.
4. **Never** weaken a test to "pass" by deleting behavioral assertions. Structural-only assertions may be replaced with role queries.
5. New components (shadcn primitives) get a smoke render test.

Commit after each task. Keep `npx vitest run` green at every commit.

---

## Phase 0 — Foundation

### Task 0.1: Install dependencies

**Files:** Modify `apps/ui/package.json`

**Step 1:** From `apps/ui`, install runtime + dev deps (use the workspace's package manager — repo uses npm at root, so `npm install` from repo root after editing, or `npm install <pkg> -w @moveet/ui`):

```bash
npm install -w @moveet/ui tailwindcss @tailwindcss/vite clsx tailwind-merge class-variance-authority lucide-react
```

**Step 2:** Verify they appear in `apps/ui/package.json` dependencies.

**Step 3: Commit**

```bash
git add apps/ui/package.json package-lock.json
git commit -m "build(ui): add tailwind v4 + shadcn runtime deps"
```

### Task 0.2: Wire the Tailwind Vite plugin

**Files:** Modify `apps/ui/vite.config.ts`

**Step 1:** Read `vite.config.ts`. Add the import and plugin:

```ts
import tailwindcss from "@tailwindcss/vite";
// ...
plugins: [react(), tailwindcss(), /* existing plugins */],
```

**Step 2:** Run `npx vite build` (or `npm run -w @moveet/ui build`). Expected: build succeeds (Tailwind has nothing to scan yet, that's fine).

**Step 3: Commit**

```bash
git add apps/ui/vite.config.ts
git commit -m "build(ui): wire @tailwindcss/vite plugin"
```

### Task 0.3: Tailwind v4 theme + dark-only tokens in index.css

**Files:** Modify `apps/ui/src/index.css`

**Step 1:** Read current `src/index.css`. Replace its reset/import with Tailwind v4 setup. Top of file:

```css
@import "tailwindcss";

/* dark-only: force the dark token set everywhere */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --radius: 0.5rem;
}

@theme {
  /* shadcn maps these; values are the slate dark palette (oklch) */
  --color-background: oklch(0.129 0.042 264.695);
  --color-foreground: oklch(0.984 0.003 247.858);
  --color-card: oklch(0.208 0.042 265.755);
  --color-card-foreground: oklch(0.984 0.003 247.858);
  --color-popover: oklch(0.208 0.042 265.755);
  --color-popover-foreground: oklch(0.984 0.003 247.858);
  --color-primary: oklch(0.929 0.013 255.508);
  --color-primary-foreground: oklch(0.208 0.042 265.755);
  --color-secondary: oklch(0.279 0.041 260.031);
  --color-secondary-foreground: oklch(0.984 0.003 247.858);
  --color-muted: oklch(0.279 0.041 260.031);
  --color-muted-foreground: oklch(0.704 0.04 256.788);
  --color-accent: oklch(0.279 0.041 260.031);
  --color-accent-foreground: oklch(0.984 0.003 247.858);
  --color-destructive: oklch(0.704 0.191 22.216);
  --color-border: oklch(1 0 0 / 10%);
  --color-input: oklch(1 0 0 / 15%);
  --color-ring: oklch(0.551 0.027 264.364);

  /* domain semantic status tokens (decoupled from deck.gl ramps) */
  --color-status-ok: oklch(0.72 0.18 150);
  --color-status-warn: oklch(0.8 0.16 85);
  --color-status-error: oklch(0.64 0.21 25);
  --color-status-idle: oklch(0.7 0.03 260);
}
```

**Step 2:** In `src/main.tsx`, ensure the root `<html>` carries `dark`. Simplest: add to `index.html` `<html class="dark">`. Read `apps/ui/index.html`, add `class="dark"` to the `<html>` tag.

**Step 3:** Run `npx vite build`. Expected: success.

**Step 4:** Run `npx vitest run`. Expected: still 621 passing (no component changed yet; old CSS Modules still applied).

**Step 5: Commit**

```bash
git add apps/ui/src/index.css apps/ui/index.html
git commit -m "feat(ui): tailwind v4 theme + dark-only tokens"
```

### Task 0.4: shadcn init + cn() utility

**Files:** Create `apps/ui/components.json`, `apps/ui/src/lib/utils.ts`. Possibly modify `tsconfig` paths.

**Step 1:** Run the shadcn CLI from `apps/ui`:

```bash
npx shadcn@latest init
```

Answer prompts: style = default, base color = slate, CSS variables = yes. If the CLI cannot detect Vite 8 / errors, fall back: manually create `components.json` (see shadcn docs schema) and `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 2:** Ensure `@/` path alias resolves. Check `apps/ui/tsconfig.json` / `tsconfig.app.json` has:

```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

And `vite.config.ts` has a matching `resolve.alias` for `@` → `/src` (add if missing).

**Step 3:** Run `npx tsc -b --noEmit`. Expected: clean.

**Step 4: Commit**

```bash
git add apps/ui/components.json apps/ui/src/lib/utils.ts apps/ui/tsconfig*.json apps/ui/vite.config.ts
git commit -m "build(ui): shadcn init + cn() helper + @ alias"
```

---

## Phase 1 — Primitives & Inputs wrappers (high leverage)

Generate the shadcn primitives this app needs, then **rebuild the `src/components/Inputs/` wrappers on top of them** so the 11 files importing `components/Inputs` migrate for free.

### Task 1.1: Generate shadcn primitives

**Files:** Create `apps/ui/src/components/ui/*.tsx`

**Step 1:** Add the primitives the design maps to:

```bash
npx shadcn@latest add button input label switch slider select popover command tabs sheet card sonner tooltip dialog
```

(`command` + `popover` back the Combobox; `sonner` replaces Toast; `sheet` replaces AdapterDrawer; `dialog` backs CreateZoneDialog.)

**Step 2:** Smoke test — create `src/components/ui/__tests__/primitives.smoke.test.tsx` rendering `<Button>ok</Button>` and asserting `getByRole('button', { name: 'ok' })`.

**Step 3:** Run `npx vitest run src/components/ui`. Expected: PASS.

**Step 4: Commit**

```bash
git add apps/ui/src/components/ui apps/ui/src/components/ui/__tests__
git commit -m "feat(ui): add shadcn primitives"
```

### Task 1.2: Rebuild Inputs/Button on shadcn

**Files:** Modify `src/components/Inputs/Button.tsx`, `src/components/Inputs/SquaredButton.tsx`. Test: `src/components/__tests__` (find existing button test).

**Step 1:** Read current `Button.tsx` to capture its public props (variants, sizes, `isDisabled`, `onPress` vs `onClick`). Note: react-aria uses `onPress`; shadcn/Radix uses `onClick`. Map the prop surface so callers don't change — keep the same exported prop names, translate internally.

**Step 2:** Reimplement `Button` to render shadcn `ui/button` `Button`, mapping the existing prop names to shadcn `variant`/`size` + Tailwind classes via `cn()`. Preserve `onPress`→`onClick` if callers use `onPress`.

**Step 3:** Do the same for `SquaredButton` (likely an icon button → shadcn `Button` with `size="icon"`).

**Step 4:** Run the relevant tests + a grep-driven sanity build:

```bash
npx vitest run src/components
npx tsc -b --noEmit
```

Expected: green. If callers used `onPress`, TS will flag mismatches — fix the wrapper, not the callers.

**Step 5: Commit**

```bash
git add apps/ui/src/components/Inputs/Button.tsx apps/ui/src/components/Inputs/SquaredButton.tsx
git commit -m "feat(ui): rebuild Inputs Button/SquaredButton on shadcn"
```

### Task 1.3: Rebuild Inputs/Input + Inputs/Switch + Inputs/Range on shadcn

**Files:** Modify `src/components/Inputs/Input.tsx`, `Switch.tsx`, `Range.tsx`. Tests under `src/components/__tests__`.

**Step 1:** For each, read current props, reimplement on the matching shadcn primitive (`ui/input`, `ui/switch`, `ui/slider`). Preserve exported prop names; translate react-aria callbacks (`onChange` value semantics differ — react-aria Switch `onChange(boolean)`, Radix `onCheckedChange(boolean)`; react-aria Slider `onChange(number|number[])`, Radix `onValueChange(number[])`). Normalize inside the wrapper so callers are unchanged.

**Step 2:** Run `npx vitest run src/components` + `npx tsc -b --noEmit`. Expected: green; fix structural test queries to role-based.

**Step 3: Commit**

```bash
git add apps/ui/src/components/Inputs
git commit -m "feat(ui): rebuild Inputs Input/Switch/Range on shadcn"
```

### Task 1.4: Rebuild Inputs/Typeahead as shadcn Combobox

**Files:** Modify `src/components/Inputs/Typeahead.tsx`. Test: find existing.

**Step 1:** Read current Typeahead (react-aria `ComboBox`). Reimplement using shadcn `Command` inside `Popover` (the standard shadcn combobox pattern). Keep the exported props (items, value, onChange, placeholder) identical.

**Step 2:** Manually verify keyboard nav (arrow keys, enter, escape) — Radix Command behavior differs from react-aria. Note in commit if any behavior intentionally changed.

**Step 3:** Run `npx vitest run src/components` + tsc. Green.

**Step 4: Commit**

```bash
git add apps/ui/src/components/Inputs/Typeahead.tsx
git commit -m "feat(ui): rebuild Inputs Typeahead as shadcn Combobox"
```

### Task 1.5: Inputs styling → Tailwind, delete Inputs.module.css

**Files:** Modify the 6 `Inputs/*.tsx`; Delete `src/components/Inputs/Inputs.module.css`.

**Step 1:** Replace any remaining `styles.x` / `classNames` usage in the Inputs wrappers with Tailwind utility classes. Remove the `Inputs.module.css` import.

**Step 2:** `git rm src/components/Inputs/Inputs.module.css`.

**Step 3:** `npx vitest run src/components` + `npx tsc -b --noEmit` + `npx eslint src/components/Inputs`. Green.

**Step 4: Commit**

```bash
git add -A apps/ui/src/components/Inputs
git commit -m "refactor(ui): Tailwind-style Inputs wrappers, drop Inputs.module.css"
```

### Task 1.6: Icons.tsx → lucide-react

**Files:** Modify `src/components/Icons.tsx` and all importers. Test: `src/components/__tests__/Icons*`.

**Step 1:** Read `Icons.tsx`, list every exported icon name. Map each to a lucide-react equivalent. Reexport from `Icons.tsx` as thin aliases (e.g. `export const PlayIcon = Play;`) so importers don't change.

**Step 2:** Delete custom SVG markup. Update/rewrite icon tests to assert presence by `aria-hidden`/role rather than SVG path.

**Step 3:** `npx vitest run src/components` + tsc + eslint. Green.

**Step 4: Commit**

```bash
git add apps/ui/src/components/Icons.tsx apps/ui/src/components/__tests__
git commit -m "refactor(ui): replace custom Icons with lucide-react aliases"
```

### Task 1.7: Toast.tsx → Sonner

**Files:** Modify `src/components/Toast.tsx`; Delete `src/components/Toast.module.css`. Test: `src/components/Toast.test.tsx`.

**Step 1:** Read `Toast.tsx` + its test to capture the API (`toast(...)`, provider mount point). Reimplement on `ui/sonner` — mount `<Toaster />` where the old provider was, reexport a `toast()` that calls sonner. Keep the public API name-compatible.

**Step 2:** `git rm src/components/Toast.module.css`.

**Step 3:** Update `Toast.test.tsx` to sonner's DOM/role. `npx vitest run src/components` green.

**Step 4: Commit**

```bash
git add -A apps/ui/src/components
git commit -m "feat(ui): replace Toast with Sonner"
```

### Task 1.8: PanelPrimitives → Tailwind (Card-based)

**Files:** Modify `src/Controls/PanelPrimitives.tsx`; Delete `src/Controls/PanelPrimitives.module.css`.

**Step 1:** Read `PanelPrimitives.tsx` (PanelShell/Header/Body/etc.). Reimplement each as a Tailwind-classed wrapper (lean on `ui/card` where it fits) keeping the exact exported component names + props — every Controls panel depends on these.

**Step 2:** `git rm src/Controls/PanelPrimitives.module.css`.

**Step 3:** `npx vitest run src/Controls` + tsc + eslint. Green.

**Step 4: Commit**

```bash
git add -A apps/ui/src/Controls/PanelPrimitives.tsx
git commit -m "refactor(ui): Tailwind-based PanelPrimitives"
```

---

## Phase 2 — Convert direct react-aria consumers

These 11 files import react-aria-components directly (not via Inputs/). Convert each to the shadcn primitive / rebuilt Inputs wrapper.

**Files (one task each, same recipe):**
`SearchBar/index.tsx`, `Controls/DispatchFooter.tsx`, `Controls/RecordReplay.tsx`, `Controls/Vehicles.tsx`, `Controls/ClockPanel.tsx`, `Controls/Fleets.tsx`, `Controls/ScenariosPanel.tsx`, `Controls/BottomDock.tsx`, `Controls/Adapter/ConfigForm.tsx`, `Controls/Adapter/SourceTab.tsx`, `Controls/Adapter/SinksTab.tsx`.

**Per-file recipe (Task 2.x):**

**Step 1:** Run the file's existing test (`npx vitest run <path>`), confirm green.
**Step 2:** Replace each `react-aria-components` import with the corresponding `components/Inputs` wrapper or `components/ui` primitive (Button→Inputs/Button or ui/button, Slider→Inputs/Range, Switch→Inputs/Switch, Select/ComboBox→ui/select or Inputs/Typeahead, Popover→ui/popover).
**Step 3:** Translate any react-aria-only props (`onPress`, `isDisabled`, render-prop children) to the shadcn API.
**Step 4:** `npx vitest run <path>` + `npx tsc -b --noEmit`. Fix structural test queries to role-based; keep behavioral assertions.
**Step 5:** Commit: `refactor(ui): migrate <File> off react-aria`.

After all 11 done, no `src/**` file should import `react-aria-components` except possibly leftover types — verify:

```bash
grep -rl "react-aria-components" src   # expect: empty
```

---

## Phase 3 — CSS Modules → Tailwind, per zone

Convert remaining `.module.css` files to Tailwind utilities on their components and delete them. **One task per file.** Group commits by zone.

**Per-file recipe (Task 3.x):**

**Step 1:** Run the component's test, confirm green.
**Step 2:** Read the `.module.css`, translate each rule to Tailwind utility classes on the JSX (use the theme tokens: `bg-background`, `text-muted-foreground`, `border-border`, status tokens `text-status-ok` etc.). Apply the _fresh_ aesthetic — don't slavishly reproduce old spacing; use shadcn density (`text-sm`, `gap-2`, `rounded-md`, `--radius`).
**Step 3:** Remove the `styles` import; `git rm` the `.module.css`.
**Step 4:** `npx vitest run <path>` + tsc + eslint. Green.
**Step 5:** Commit.

### Zone A — Controls (Task 3.1–3.13)

`AdapterDrawer.module.css` (→ also swap to `ui/sheet`), `AnalyticsPanel`, `BottomDock`, `ClockPanel`, `DispatchFooter`, `Fleets`, `GeofencePanel`, `IconRail`, `Incidents`, `RecordReplay`, `ScenariosPanel`, `SpeedPanel`, `TogglesPanel`, `Vehicles` modules.
Also migrate Adapter tabs (`SourceTab`/`SinksTab`/`RealismTab`) to `ui/tabs` if not already.

### Zone B — components (Task 3.14–3.17)

`ConnectionStatus.module.css`, `ContextMenu.module.css` (→ consider `ui/popover`/`ui/dropdown-menu`), `ErrorBoundary.module.css`, `LoadingOverlay.module.css`. Also `MapContextMenu.tsx`.

### Zone C — Map chrome only (Task 3.18–3.24)

`FleetLegend`, `IncidentMarkers`, `TypeLegend`, `Geofence/CreateZoneDialog` (→ `ui/dialog`), `POI/POI`, `Vehicle/Vehicle`, plus `SearchBar/SearchBar.module.css`, `Zoom/Zoom.module.css`.
**Do NOT touch** deck.gl layer logic (`VehiclesLayer`, `GeofenceLayer`, `BreadcrumbLayer`, `HeatLayer`, `DeckGLMap`, `Road`, `Direction`, `TrafficOverlay`, etc.) — only their styling/chrome. For deck.gl `getTooltip` HTML, keep inline styles (documented limitation).

### Zone D — App shell (Task 3.25)

`App.module.css` → Tailwind layout on `App.tsx`. `git rm App.module.css`.

After Phase 3:

```bash
find src -name "*.module.css"   # expect: empty
```

---

## Phase 4 — Cleanup & final verification

### Task 4.1: Remove dead dependencies

**Step 1:** Remove from `apps/ui/package.json`: `react-aria-components`, `classnames`, `the-new-css-reset`, `sass-embedded` (only if no `.scss` remain — there are none).

```bash
npm uninstall -w @moveet/ui react-aria-components classnames the-new-css-reset sass-embedded
```

**Step 2:** `grep -rl "classnames\|react-aria-components\|the-new-css-reset" src` → expect empty.
**Step 3: Commit:** `chore(ui): drop react-aria, classnames, css-reset, sass`.

### Task 4.2: Full green gate

**Step 1:** Run all three from `apps/ui`:

```bash
npx vitest run        # expect: ~621 (some test counts shift) all passing
npx tsc -b --noEmit   # clean
npx eslint .          # clean
```

**Step 2:** Run `npm run -w @moveet/ui build`. Expect success.
**Step 3:** Manual smoke (REQUIRED — no visual regression net): use superpowers `run`/Chrome DevTools skill to launch `yarn dev` and click through each panel zone, the search combobox, sliders, switches, the adapter sheet, and a geofence dialog. Verify dark theme renders and keyboard nav works on Combobox/Select/Slider.

### Task 4.3: Code review + PR

**Step 1:** REQUIRED SUB-SKILL: superpowers:requesting-code-review.
**Step 2:** Use the linear-tracker / PR flow per repo convention (always PR, never push main). Reference the design doc.

---

## Verification checklist (end state)

- [ ] `find src -name "*.module.css"` → empty
- [ ] `grep -rl "react-aria-components" src` → empty
- [ ] `grep -rl "classnames" src` → empty
- [ ] `npx vitest run` green
- [ ] `npx tsc -b --noEmit` clean
- [ ] `npx eslint .` clean
- [ ] `npm run -w @moveet/ui build` succeeds
- [ ] deck.gl layers untouched (only chrome migrated)
- [ ] Manual dark-theme smoke pass across all zones
