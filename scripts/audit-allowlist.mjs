#!/usr/bin/env node
/**
 * `npm audit`, minus a small set of explicitly accepted advisories.
 *
 * `npm audit` is all-or-nothing: there is no way to accept one finding without
 * lowering `--audit-level` and losing the gate for everything else. This wraps
 * it so the gate stays exactly as strict as before for every advisory that is
 * not named below.
 *
 * Two properties this has that a looser `--audit-level` would not:
 *
 *   1. An accepted advisory is accepted **only through the dependency path
 *      recorded with it**. If the same advisory turns up somewhere else — a
 *      direct dependency, a different transitive chain — it fails the build.
 *   2. An entry that no longer matches anything fails the build as stale. An
 *      exception that outlives its reason is the usual way a list like this
 *      rots into a blanket opt-out.
 *
 * Usage: node scripts/audit-allowlist.mjs [--audit-level=high]
 */
import { execFileSync } from "node:child_process";

/** Severities that fail the build, mirroring `npm audit --audit-level=high`. */
const FAILING = new Set(["high", "critical"]);

/**
 * Advisories accepted for now, each with the path that justifies it.
 *
 * `via` is the package the advisory is filed against. `through` is the
 * dependency chain that pulls it in: the finding is accepted only when the
 * chain still matches, so the exception cannot silently widen.
 */
const ALLOWED = [
  {
    id: "GHSA-w3rx-r6r6-pgpr",
    via: "image-size",
    through: "@deck.gl/mesh-layers",
    reason:
      "ICNS parser infinite loop. Reached only through the glTF/texture path " +
      "of @deck.gl/mesh-layers (gltf -> textures -> texture-compressor). " +
      "Moveet renders procedural geometry and never loads a glTF asset, a " +
      "texture or an image through that path, and the whole chain is " +
      "tree-shaken out of the browser bundle. No version combination removes " +
      "it: @loaders.gl/textures dropped texture-compressor in 4.5.1, but " +
      "@luma.gl/gltf pins ~4.4.0, and every 4.4.x textures depends on it.",
    review: "Revisit when @luma.gl/gltf accepts @loaders.gl 4.5.x.",
  },
  {
    id: "GHSA-5p2g-fcmc-qvqq",
    via: "image-size",
    through: "@deck.gl/mesh-layers",
    reason: "JXL/HEIF parser infinite loops. Same package and same path as above.",
    review: "Revisit when @luma.gl/gltf accepts @loaders.gl 4.5.x.",
  },
];

function runAudit() {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm exits non-zero whenever it finds anything, so a non-zero exit is the
    // normal case here. Only a genuinely empty stdout means the run failed.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

/** Every advisory id attached to a vulnerability, including nested `via`s. */
function advisoryIds(vuln, report, seen = new Set()) {
  const ids = new Set();
  for (const via of vuln.via ?? []) {
    if (typeof via === "object" && via.url) {
      const match = via.url.match(/(GHSA-[\w-]+)/);
      if (match) ids.add(match[1]);
    } else if (typeof via === "string" && !seen.has(via)) {
      // A string `via` names another vulnerable package; follow it once.
      seen.add(via);
      const parent = report.vulnerabilities?.[via];
      if (parent) for (const id of advisoryIds(parent, report, seen)) ids.add(id);
    }
  }
  return ids;
}

/**
 * Every package npm reports as affected downstream of `name`, including itself.
 *
 * npm files one finding per package along the chain — the vulnerable package,
 * then each dependant that pulls it in — all carrying the same advisory. They
 * are one problem, so the allowlist accepts the chain as a unit rather than
 * needing an entry per link.
 */
function affectedChain(name, report, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const effect of report.vulnerabilities?.[name]?.effects ?? []) {
    affectedChain(effect, report, seen);
  }
  return seen;
}

const report = JSON.parse(runAudit());
const vulnerabilities = Object.values(report.vulnerabilities ?? {});

/**
 * Resolve each allowlist entry to the exact set of packages it covers.
 *
 * An entry only takes effect if the chain from its `via` package actually
 * reaches its `through` package. If the advisory turns up somewhere else
 * entirely, the chain will not contain `through`, nothing is accepted, and the
 * finding fails the build as it should.
 */
const coverage = new Map();
for (const entry of ALLOWED) {
  const origin = report.vulnerabilities?.[entry.via];
  if (!origin) continue;
  const reached = affectedChain(entry.via, report);
  if (!reached.has(entry.through)) continue;
  coverage.set(entry.id, { entry, reached });
}

const blocking = [];
const accepted = new Set();

for (const vuln of vulnerabilities) {
  if (!FAILING.has(vuln.severity)) continue;
  const ids = [...advisoryIds(vuln, report)];

  // Every advisory on this package must be covered, and this package must be
  // on the covered chain. One unaccepted advisory sharing a package with an
  // accepted one still fails.
  const covering = ids.map((id) => coverage.get(id));
  const fullyCovered = ids.length > 0 && covering.every((cover) => cover?.reached.has(vuln.name));

  if (fullyCovered) {
    for (const id of ids) accepted.add(id);
    continue;
  }
  blocking.push({ name: vuln.name, severity: vuln.severity, ids });
}

const stale = ALLOWED.filter((entry) => !accepted.has(entry.id));

for (const entry of ALLOWED) {
  if (accepted.has(entry.id)) {
    console.log(`accepted  ${entry.id}  ${entry.via} via ${entry.through}`);
  }
}

if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} unaccepted high/critical advisor${blocking.length === 1 ? "y" : "ies"}:`
  );
  for (const vuln of blocking) {
    console.error(`  ${vuln.severity.padEnd(8)} ${vuln.name}  ${vuln.ids.join(", ")}`);
  }
  console.error("\nResolve with `npm audit fix`, a safe dependency bump, or — only if");
  console.error("genuinely unreachable — a documented entry in scripts/audit-allowlist.mjs.");
  process.exit(1);
}

if (stale.length > 0) {
  const verb = stale.length === 1 ? "entry no longer matches" : "entries no longer match";
  console.error(`\n${stale.length} allowlist ${verb} anything:`);
  for (const entry of stale) {
    console.error(`  ${entry.id}  ${entry.via} via ${entry.through}`);
  }
  console.error("\nThe advisory is gone or moved. Delete the entry from");
  console.error("scripts/audit-allowlist.mjs — an exception that outlives its reason");
  console.error("is how an allowlist turns into a blanket opt-out.");
  process.exit(1);
}

console.log(
  `\nNo unaccepted high or critical advisories (${vulnerabilities.length} total findings).`
);
