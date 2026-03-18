import { describe, it, expect } from "vitest";
import { buildDownloadUrl, getCachePath, shouldSkipDownload } from "./download.js";
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
    expect(url).toBe(
      "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf"
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
