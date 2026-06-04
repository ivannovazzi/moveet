# Migration Style Contract (shared by all migration agents)

You are converting one slice of `apps/ui` from CSS Modules + react-aria-components to
Tailwind v4 + shadcn/ui. Dark-only. Fresh shadcn aesthetic (don't slavishly reproduce old
pixel spacing — adopt the conventions below). **Work only on the files in your assigned
scope. Do NOT run the test suite, build, or git commit — the orchestrator verifies once at
the end.** Edit files only.

## Hard rules

1. **Preserve every component's public API** (exported names, prop names, behavior). Callers
   must not need to change. If a react-aria prop has no shadcn equivalent, translate it
   internally.
2. **Delete the `.module.css` sibling** of every component you fully convert (use the file
   system; remove the `import styles from "./X.module.css"` line).
3. **No `classnames` import.** Use `cn` from `@/lib/utils` (`import { cn } from "@/lib/utils"`).
4. **No `react-aria-components` imports** left in your files. Replace with the rebuilt
   `@/components/Inputs/*` wrappers or `@/components/ui/*` primitives.
5. **Icons:** import from `@/components/Icons` (already aliased to lucide) — don't import
   `lucide-react` directly in feature components.
6. **Do not touch deck.gl layer logic** (anything that builds deck.gl `Layer`s, e.g.
   `*Layer.tsx`, `DeckGLMap`, `Road`, `Direction`, `Heatmap`, `TrafficOverlay`,
   `useDeckLayers`). Only convert the React chrome/DOM and its styling.

## Token & utility conventions (use these, not raw hex)

| Purpose              | Tailwind class                              |
| -------------------- | ------------------------------------------- |
| App/page bg          | `bg-background`                             |
| Panel/card surface   | `bg-card`                                   |
| Popover/menu bg      | `bg-popover`                                |
| Body text            | `text-foreground`                           |
| Secondary text       | `text-muted-foreground`                     |
| Borders              | `border-border`                             |
| Primary action       | `bg-primary text-primary-foreground`        |
| Accent/links/focus   | `text-accent` / `ring-ring`                 |
| Status: ok/online    | `text-status-ok` / `bg-status-ok`           |
| Status: warn         | `text-status-warn`                          |
| Status: error/danger | `text-status-error` / `border-status-error` |
| Status: idle         | `text-status-idle`                          |

- **Density (ops UI):** baseline `text-sm`; control gaps `gap-2`; panel padding `p-3`/`p-4`;
  rounded `rounded-md`; rely on `--radius: 0.5rem`.
- **Glass/overlay panels** that floated over the map: use
  `bg-card/80 backdrop-blur-md border border-border rounded-lg shadow-lg`.
- **Absolute map-overlay positioning** stays the same structure — express it with utilities
  (`absolute top-4 right-4 z-10` etc.).
- Buttons → `@/components/Inputs` `Button`/`SquaredButton` (already shadcn-backed) or
  `@/components/ui/button`. Sliders → `Range`. Switches → `Switch`. Text inputs → `Input`.
  Typeahead/combobox → `Typeahead`. Tabs → `@/components/ui/tabs`. Side drawers →
  `@/components/ui/sheet`. Modal dialogs → `@/components/ui/dialog`. Dropdown/context menus →
  `@/components/ui/dropdown-menu` or `@/components/ui/popover`.

## Tests

- For each component you touch that has a `*.test.tsx`, update it so it stays correct.
- Prefer **role / accessible-name queries** (`getByRole('switch', { name })`,
  `getByRole('button', { name })`) over class-name / DOM-structure queries.
- **Never delete a behavioral assertion** to make a test pass. Only replace structural/style
  assertions (querying by CSS-module class) with role-based equivalents.
- Don't run the tests yourself — just make them correct by inspection.

## Output

Return a concise summary: files changed, `.module.css` files deleted, any react-aria prop
translations you made, any test queries you rewrote, and anything you were unsure about that
the orchestrator should double-check.
