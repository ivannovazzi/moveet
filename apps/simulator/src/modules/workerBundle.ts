import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Path of a bundled worker script (`dist/workers/<name>.cjs`).
 *
 * Workers are ALWAYS launched as pre-bundled, self-contained files: they import
 * shared modules with extensionless ESM specifiers that plain Node (and tsx,
 * whose loader does not propagate into worker_threads) cannot resolve from the
 * raw `.ts`. `build:worker` (esbuild) emits `dist/workers/<name>.cjs`; dev
 * (tsx), vitest and the production image all launch that same `.cjs`.
 *
 * Resolved across run modes:
 *  - dev/tsx/vitest: src/modules -> ../../dist/workers/*.cjs
 *  - tsc/esbuild:    dist/modules (or bundled dist) -> dist/workers/*.cjs
 *  - legacy esbuild ESM output kept as a fallback: dist/workers/*.js
 */
export function workerBundlePath(name: string): string {
  const candidates = [
    path.join(__dirname, "..", "..", "dist", "workers", `${name}.cjs`),
    path.join(__dirname, "..", "workers", `${name}.cjs`),
    path.join(__dirname, "workers", `${name}.cjs`),
    path.join(__dirname, "..", "workers", `${name}.js`),
    path.join(__dirname, "workers", `${name}.js`),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1];
}
