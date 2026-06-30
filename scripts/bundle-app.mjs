// Bundle a Moveet app entrypoint for production (plain `node dist/...`).
//
// Real npm dependencies (incl. native modules like better-sqlite3) are kept
// EXTERNAL and loaded from node_modules at runtime. The internal `@moveet/*`
// workspace packages are BUNDLED IN, because they ship raw TypeScript with
// extensionless ESM imports (e.g. `export * from "./logger"`) that Node's ESM
// loader cannot resolve at runtime. esbuild resolves those at bundle time, so
// inlining them sidesteps the extensionless-import problem the same way the
// app's own source is bundled.
//
// Usage: node scripts/bundle-app.mjs <entry.ts> <outfile.js>

import esbuild from "esbuild";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("usage: node scripts/bundle-app.mjs <entry> <outfile>");
  process.exit(1);
}

/**
 * Externalize every bare import (npm deps, node builtins) EXCEPT the internal
 * `@moveet/*` workspace packages, which fall through to normal resolution and
 * get bundled. Relative imports (starting with "." or "/") never match this
 * filter, so the app's own modules are bundled as usual.
 */
const externalizeNpmDeps = {
  name: "externalize-npm-deps",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@moveet/")) return undefined; // bundle workspace pkgs
      return { path: args.path, external: true };
    });
  },
};

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile,
  plugins: [externalizeNpmDeps],
});

console.log(`Bundled ${outfile}`);
