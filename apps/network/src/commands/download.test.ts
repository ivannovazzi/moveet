import { describe, it, expect } from "vitest";
import {
  buildChecksumUrl,
  buildDownloadUrl,
  getCachePath,
  parseChecksumFile,
  shouldSkipDownload,
} from "./download.js";
import fs from "fs";
import os from "os";
import path from "path";

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
