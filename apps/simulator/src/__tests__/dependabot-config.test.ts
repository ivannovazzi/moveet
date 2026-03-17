import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPENDABOT_PATH = path.resolve(__dirname, "../../../../.github/dependabot.yml");

describe("dependabot.yml", () => {
  it("exists at .github/dependabot.yml", () => {
    expect(fs.existsSync(DEPENDABOT_PATH)).toBe(true);
  });

  it("is valid YAML", () => {
    const raw = fs.readFileSync(DEPENDABOT_PATH, "utf-8");
    expect(() => parseYaml(raw)).not.toThrow();
  });

  describe("structure validation", () => {
    let config: Record<string, unknown>;

    function loadConfig() {
      const raw = fs.readFileSync(DEPENDABOT_PATH, "utf-8");
      return parseYaml(raw) as Record<string, unknown>;
    }

    it("has version 2", () => {
      config = loadConfig();
      expect(config.version).toBe(2);
    });

    it("has an updates array", () => {
      config = loadConfig();
      expect(Array.isArray(config.updates)).toBe(true);
      expect((config.updates as unknown[]).length).toBeGreaterThan(0);
    });

    it("includes npm ecosystem entries for root, simulator, adapter, and ui", () => {
      config = loadConfig();
      const updates = config.updates as Array<{
        "package-ecosystem": string;
        directory: string;
      }>;

      const npmEntries = updates.filter((u) => u["package-ecosystem"] === "npm");
      const directories = npmEntries.map((u) => u.directory);

      expect(directories).toContain("/");
      expect(directories).toContain("/apps/simulator");
      expect(directories).toContain("/apps/adapter");
      expect(directories).toContain("/apps/ui");
    });

    it("includes a github-actions ecosystem entry", () => {
      config = loadConfig();
      const updates = config.updates as Array<{
        "package-ecosystem": string;
      }>;

      const actionsEntries = updates.filter((u) => u["package-ecosystem"] === "github-actions");
      expect(actionsEntries.length).toBeGreaterThanOrEqual(1);
    });

    it("every entry has a schedule with interval", () => {
      config = loadConfig();
      const updates = config.updates as Array<{
        schedule: { interval: string };
      }>;

      for (const entry of updates) {
        expect(entry.schedule).toBeDefined();
        expect(["daily", "weekly", "monthly"].includes(entry.schedule.interval)).toBe(true);
      }
    });

    it("every entry has an open-pull-requests-limit", () => {
      config = loadConfig();
      const updates = config.updates as Array<{
        "open-pull-requests-limit": number;
      }>;

      for (const entry of updates) {
        expect(entry["open-pull-requests-limit"]).toBeGreaterThan(0);
      }
    });
  });
});
