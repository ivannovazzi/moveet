import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import { URL } from "url";

const GEOFABRIK_BASE = "https://download.geofabrik.de";

export function buildDownloadUrl(geofabrik: string): string {
  return `${GEOFABRIK_BASE}/${geofabrik}-latest.osm.pbf`;
}

export function getCachePath(geofabrik: string, cacheDir: string): string {
  const safeName = geofabrik.replace(/\//g, "-");
  return path.join(cacheDir, `${safeName}-latest.osm.pbf`);
}

export function getEtagPath(pbfPath: string): string {
  return `${pbfPath}.etag`;
}

export function shouldSkipDownload(
  pbfPath: string,
  newEtag: string | undefined
): boolean {
  if (!fs.existsSync(pbfPath)) return false;
  if (!newEtag) return false;
  const etagPath = getEtagPath(pbfPath);
  if (!fs.existsSync(etagPath)) return false;
  const savedEtag = fs.readFileSync(etagPath, "utf8").trim();
  return savedEtag === newEtag;
}

export interface DownloadOptions {
  geofabrik: string;
  cacheDir: string;
  force?: boolean;
}

export async function download(opts: DownloadOptions): Promise<string> {
  const { geofabrik, cacheDir, force = false } = opts;
  fs.mkdirSync(cacheDir, { recursive: true });

  const url = buildDownloadUrl(geofabrik);
  const dest = getCachePath(geofabrik, cacheDir);
  const etagPath = getEtagPath(dest);

  const headEtag = await getEtag(url);

  if (!force && shouldSkipDownload(dest, headEtag ?? undefined)) {
    process.stdout.write(`Skipping download (cached): ${path.basename(dest)}\n`);
    return dest;
  }

  process.stdout.write(`Downloading ${url}\n`);
  await streamDownload(url, dest);

  if (headEtag) {
    fs.writeFileSync(etagPath, headEtag, "utf8");
  }

  return dest;
}

function getEtag(url: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const req = mod.request(url, { method: "HEAD" }, (res) => {
      resolve((res.headers["etag"] as string) ?? null);
    });
    req.on("error", reject);
    req.end();
  });
}

function streamDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(dest);
    mod
      .get(url, (res) => {
        const total = parseInt(res.headers["content-length"] ?? "0", 10);
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(
              `\r  ${pct}% (${(received / 1e6).toFixed(1)} MB)`
            );
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          process.stdout.write("\n");
          file.close();
          resolve();
        });
      })
      .on("error", reject);
  });
}
