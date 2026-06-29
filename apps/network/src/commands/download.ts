import crypto from "crypto";
import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import { URL } from "url";

const GEOFABRIK_BASE = "https://download.geofabrik.de";

export function buildDownloadUrl(geofabrik: string): string {
  return `${GEOFABRIK_BASE}/${geofabrik}-latest.osm.pbf`;
}

// Geofabrik publishes an MD5 checksum next to every extract at the same URL
// with `.md5` appended.
export function buildChecksumUrl(geofabrik: string): string {
  return `${buildDownloadUrl(geofabrik)}.md5`;
}

// A Geofabrik `.md5` file is a single line of the form `<md5hex>  <filename>`.
// Return just the lowercased hex digest, or null if the contents are not a
// recognisable 32-char hex checksum.
export function parseChecksumFile(contents: string): string | null {
  const token = contents.trim().split(/\s+/)[0]?.toLowerCase();
  if (token && /^[0-9a-f]{32}$/.test(token)) return token;
  return null;
}

export function getCachePath(geofabrik: string, cacheDir: string): string {
  const safeName = geofabrik.replace(/\//g, "-");
  return path.join(cacheDir, `${safeName}-latest.osm.pbf`);
}

export function getEtagPath(pbfPath: string): string {
  return `${pbfPath}.etag`;
}

export function shouldSkipDownload(pbfPath: string, newEtag: string | undefined): boolean {
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

  await verifyChecksum(geofabrik, dest);

  // Only record the ETag after a verified, fully-written file exists, so a
  // truncated download never gets cached as valid.
  if (headEtag) {
    fs.writeFileSync(etagPath, headEtag, "utf8");
  }

  return dest;
}

// Verify the downloaded file against Geofabrik's published MD5. A missing or
// unreachable checksum is a soft failure (warn and continue) so a transient
// network blip or a region without a published checksum does not break the
// whole pipeline. An actual digest mismatch is a hard failure: the suspect
// file is deleted so it can never be reused from cache.
export async function verifyChecksum(geofabrik: string, pbfPath: string): Promise<void> {
  const checksumUrl = buildChecksumUrl(geofabrik);
  const checksumText = await fetchText(checksumUrl);
  if (checksumText === null) {
    process.stdout.write(
      `Warning: could not fetch checksum ${checksumUrl}, skipping integrity verification\n`
    );
    return;
  }

  const expected = parseChecksumFile(checksumText);
  if (!expected) {
    process.stdout.write(
      `Warning: unrecognised checksum file at ${checksumUrl}, skipping integrity verification\n`
    );
    return;
  }

  const actual = await computeMd5(pbfPath);
  if (actual !== expected) {
    try {
      if (fs.existsSync(pbfPath)) fs.unlinkSync(pbfPath);
    } catch {
      // best-effort cleanup
    }
    throw new Error(
      `Checksum mismatch for ${path.basename(pbfPath)}: expected ${expected}, got ${actual}. ` +
        `The download was corrupted or tampered with and has been deleted.`
    );
  }

  process.stdout.write(`Checksum OK (md5 ${actual})\n`);
}

// Stream the file through an MD5 hash so a large .pbf is never held in memory.
export function computeMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// Fetch a small text resource (the .md5). Resolves with the body on success,
// or null on any non-2xx status or network error so callers can degrade
// gracefully rather than crash.
export function fetchText(url: string, redirects = 0): Promise<string | null> {
  if (redirects > 5) return Promise.resolve(null);
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode)) {
        const location = res.headers["location"];
        res.resume();
        if (!location) {
          resolve(null);
          return;
        }
        resolve(fetchText(location, redirects + 1));
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve(body));
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

function getEtag(url: string, redirects = 0): Promise<string | null> {
  if (redirects > 5) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const req = mod.request(url, { method: "HEAD" }, (res) => {
      if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode)) {
        const location = res.headers["location"];
        if (!location) {
          resolve(null);
          return;
        }
        resolve(getEtag(location, redirects + 1));
        return;
      }
      resolve((res.headers["etag"] as string) ?? null);
    });
    req.on("error", reject);
    req.end();
  });
}

function streamDownload(url: string, dest: string, redirects = 0): Promise<void> {
  if (redirects > 5) return Promise.reject(new Error(`Too many redirects downloading ${url}`));

  const partPath = `${dest}.part`;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(partPath);

    // Remove the partial file on any failure so a dropped connection never
    // leaves a truncated artifact behind to be reused.
    const fail = (err: Error) => {
      file.destroy();
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      } catch {
        // best-effort cleanup
      }
      reject(err);
    };

    file.on("error", fail);

    mod
      .get(url, (res) => {
        if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode)) {
          file.close();
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
          const location = res.headers["location"];
          if (!location) {
            reject(new Error(`Redirect with no Location header from ${url}`));
            return;
          }
          resolve(streamDownload(location, dest, redirects + 1));
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          fail(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] ?? "0", 10);
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(`\r  ${pct}% (${(received / 1e6).toFixed(1)} MB)`);
          }
        });
        res.on("error", fail);
        res.pipe(file);
        file.on("finish", () => {
          process.stdout.write("\n");
          file.close((closeErr) => {
            if (closeErr) {
              fail(closeErr);
              return;
            }
            // Verify completeness when the server told us the size.
            if (total > 0 && received !== total) {
              fail(
                new Error(`Incomplete download: received ${received} of ${total} bytes from ${url}`)
              );
              return;
            }
            try {
              // Atomic publish: the full file only ever appears at `dest`.
              fs.renameSync(partPath, dest);
            } catch (renameErr) {
              fail(renameErr as Error);
              return;
            }
            resolve();
          });
        });
      })
      .on("error", fail);
  });
}
