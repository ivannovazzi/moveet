import fs from "fs";
import path from "path";
import { Router } from "express";
import { asyncHandler } from "./helpers";

/**
 * Optional 3D building footprints, pre-tiled by the network CLI
 * (`npx tsx apps/network/src/cli.ts buildings <region>`) into
 * `<dir>/index.json` + `<dir>/<z>/<x>/<y>.json`.
 *
 * The data is OpenStreetMap-derived (ODbL), a nice-to-have, and gitignored like
 * `network.geojson`, so it is often simply absent. Both routes then answer 404
 * and the UI's Buildings toggle shows that there is nothing to draw. Files are
 * read on request rather than at startup, so generating the data does not need
 * a simulator restart and a simulator without it pays nothing.
 */

const INDEX_FILE = "index.json";
const NOT_GENERATED =
  "No building data. Generate it with: npx tsx apps/network/src/cli.ts buildings <region>";
/** Tiles only change when the data is regenerated. */
const TILE_MAX_AGE_MS = 5 * 60 * 1000;
const TILE_PARAM = /^\d{1,7}$/;

export interface BuildingRoutesOptions {
  /**
   * Directory holding `index.json` and the tile tree, or a getter for it that
   * is asked on every request (the active map's tiles, which change on a map
   * switch). A getter returning null means the active map has no buildings.
   */
  dir: string | (() => string | null);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(file)).isFile();
  } catch {
    return false;
  }
}

export function createBuildingRoutes({ dir }: BuildingRoutesOptions): Router {
  const router = Router();
  const resolveRoot = (): string | null => {
    const current = typeof dir === "function" ? dir() : dir;
    return current ? path.resolve(current) : null;
  };

  router.get(
    "/buildings",
    asyncHandler(async (_req, res) => {
      const root = resolveRoot();
      if (!root || !(await isFile(path.join(root, INDEX_FILE)))) {
        res.status(404).json({ error: NOT_GENERATED });
        return;
      }
      res
        .type("application/json")
        .send(await fs.promises.readFile(path.join(root, INDEX_FILE), "utf8"));
    })
  );

  router.get(
    "/buildings/:z/:x/:y",
    asyncHandler(async (req, res) => {
      const { z, x, y } = req.params as { z: string; x: string; y: string };
      // Digits only: the params become path segments, so this is also what
      // keeps a request inside `root`.
      if (![z, x, y].every((p) => TILE_PARAM.test(p))) {
        res.status(400).json({ error: "Tile coordinates must be non-negative integers" });
        return;
      }
      const relative = `${z}/${x}/${y}.json`;
      const root = resolveRoot();
      if (!root || !(await isFile(path.join(root, relative)))) {
        res.status(404).json({ error: "Tile not found" });
        return;
      }
      // `root` rather than an absolute path: send's dotfile guard only checks
      // the part below root, so a data dir under e.g. `.local/` still serves.
      res.sendFile(relative, {
        root,
        maxAge: TILE_MAX_AGE_MS,
        headers: { "Content-Type": "application/json" },
      });
    })
  );

  return router;
}
