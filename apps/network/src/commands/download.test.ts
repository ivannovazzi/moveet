import { describe, it, expect, afterEach } from "vitest";
import {
  buildChecksumUrl,
  buildDownloadUrl,
  computeMd5,
  fetchText,
  getCachePath,
  parseChecksumFile,
  shouldSkipDownload,
} from "./download.js";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

/** Spin a throwaway local HTTP server for the duration of one test. */
function withServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      run(`http://127.0.0.1:${port}`)
        .then(() => server.close(() => resolve()))
        .catch((err) => server.close(() => reject(err)));
    });
  });
}

describe("buildDownloadUrl", () => {
  it("builds correct Geofabrik URL", () => {
    const url = buildDownloadUrl("africa/kenya");
    expect(url).toBe("https://download.geofabrik.de/africa/kenya-latest.osm.pbf");
  });

  it("handles sub-region paths", () => {
    const url = buildDownloadUrl("north-america/us/new-york");
    expect(url).toBe("https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf");
  });
});

describe("buildChecksumUrl", () => {
  it("appends .md5 to the Geofabrik download URL", () => {
    const url = buildChecksumUrl("africa/kenya");
    expect(url).toBe("https://download.geofabrik.de/africa/kenya-latest.osm.pbf.md5");
  });
});

describe("parseChecksumFile", () => {
  it("extracts the hex digest from a `<md5>  <filename>` line", () => {
    const hex = "d41d8cd98f00b204e9800998ecf8427e";
    expect(parseChecksumFile(`${hex}  kenya-latest.osm.pbf`)).toBe(hex);
  });

  it("tolerates surrounding whitespace and trailing newline", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    expect(parseChecksumFile(`  ${hex}   kenya-latest.osm.pbf\n`)).toBe(hex);
  });

  it("lowercases an uppercase digest", () => {
    const hex = "ABCDEF0123456789ABCDEF0123456789";
    expect(parseChecksumFile(`${hex}  file.pbf`)).toBe(hex.toLowerCase());
  });

  it("returns null when the first token is not a 32-char hex string", () => {
    expect(parseChecksumFile("not-a-checksum file.pbf")).toBeNull();
    expect(parseChecksumFile("abc123  file.pbf")).toBeNull();
    expect(parseChecksumFile("")).toBeNull();
  });
});

describe("computeMd5", () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) fs.rmSync(f, { recursive: true, force: true });
  });

  it("computes the streaming md5 of a file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "network-md5-"));
    const file = path.join(dir, "blob.bin");
    const content = "the quick brown fox";
    fs.writeFileSync(file, content);
    tmpFiles.push(dir);
    const expected = crypto.createHash("md5").update(content).digest("hex");
    await expect(computeMd5(file)).resolves.toBe(expected);
  });

  it("rejects when the file does not exist", async () => {
    await expect(computeMd5("/no/such/file.bin")).rejects.toBeDefined();
  });
});

describe("fetchText", () => {
  it("returns the body on a 200 response", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello body");
      },
      async (base) => {
        await expect(fetchText(`${base}/x.md5`)).resolves.toBe("hello body");
      }
    );
  });

  it("returns null on a 404 (and other 4xx+) responses", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(404);
        res.end();
      },
      async (base) => {
        await expect(fetchText(`${base}/missing.md5`)).resolves.toBeNull();
      }
    );
  });

  it("follows redirects to the final body", async () => {
    await withServer(
      (req, res) => {
        if (req.url === "/start") {
          res.writeHead(302, {
            location: `${req.headers.host ? "http://" + req.headers.host : ""}/final`,
          });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end("redirected body");
      },
      async (base) => {
        await expect(fetchText(`${base}/start`)).resolves.toBe("redirected body");
      }
    );
  });

  it("returns null when the redirect has no location header", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(302);
        res.end();
      },
      async (base) => {
        await expect(fetchText(`${base}/loc-less`)).resolves.toBeNull();
      }
    );
  });

  it("returns null on a connection error", async () => {
    // Nothing is listening on this port.
    await expect(fetchText("http://127.0.0.1:1/never.md5")).resolves.toBeNull();
  });

  it("stops following after too many redirects", async () => {
    await withServer(
      (req, res) => {
        res.writeHead(302, {
          location: `${req.headers.host ? "http://" + req.headers.host : ""}/loop`,
        });
        res.end();
      },
      async (base) => {
        await expect(fetchText(`${base}/loop`)).resolves.toBeNull();
      }
    );
  });
});

describe("getCachePath", () => {
  it("derives a safe filename from geofabrik path", () => {
    const p = getCachePath("africa/kenya", "/cache");
    expect(p).toBe("/cache/africa-kenya-latest.osm.pbf");
  });

  it("handles sub-region paths", () => {
    const p = getCachePath("north-america/us/new-york", "/cache");
    expect(p).toBe("/cache/north-america-us-new-york-latest.osm.pbf");
  });
});

describe("shouldSkipDownload", () => {
  it("returns false when pbf file does not exist", () => {
    expect(shouldSkipDownload("/nonexistent.pbf", "some-etag")).toBe(false);
  });

  it("returns false when no etag provided", () => {
    expect(shouldSkipDownload("/nonexistent.pbf", undefined)).toBe(false);
  });

  it("returns true when pbf exists and etag matches saved etag", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "network-test-"));
    const pbf = path.join(dir, "test.osm.pbf");
    fs.writeFileSync(pbf, "fake pbf");
    fs.writeFileSync(`${pbf}.etag`, '"abc123"');
    expect(shouldSkipDownload(pbf, '"abc123"')).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it("returns false when etag has changed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "network-test-"));
    const pbf = path.join(dir, "test.osm.pbf");
    fs.writeFileSync(pbf, "fake pbf");
    fs.writeFileSync(`${pbf}.etag`, '"abc123"');
    expect(shouldSkipDownload(pbf, '"xyz999"')).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});
