import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createStateRoutes } from "../../routes/state";

function createMockPersistenceManager() {
  return {
    saveNow: vi.fn().mockReturnValue({ timestamp: "2024-01-01T00:00:00Z", vehicleCount: 5 }),
    restore: vi.fn().mockReturnValue(true),
    stateStore: {
      listSnapshots: vi.fn().mockReturnValue([
        { id: 1, timestamp: "2024-01-01T00:00:00Z" },
        { id: 2, timestamp: "2024-01-01T01:00:00Z" },
      ]),
    },
  };
}

function createApp(pm: ReturnType<typeof createMockPersistenceManager>) {
  const app = express();
  app.use(express.json());
  app.use(createStateRoutes(pm as any));
  return app;
}

describe("State routes", () => {
  let pm: ReturnType<typeof createMockPersistenceManager>;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    pm = createMockPersistenceManager();
    app = createApp(pm);
  });

  describe("POST /state/save", () => {
    it("should save state and return 201 with metadata", async () => {
      const res = await request(app).post("/state/save");
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("saved");
      expect(res.body.timestamp).toBe("2024-01-01T00:00:00Z");
      expect(pm.saveNow).toHaveBeenCalled();
    });

    it("should return 500 when save fails", async () => {
      pm.saveNow.mockImplementation(() => {
        throw new Error("Disk full");
      });

      const res = await request(app).post("/state/save");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Disk full");
    });
  });

  describe("POST /state/restore", () => {
    it("should restore and return success", async () => {
      const res = await request(app).post("/state/restore");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("restored");
    });

    it("should return 404 when no snapshot found", async () => {
      pm.restore.mockReturnValue(false);
      const res = await request(app).post("/state/restore");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("No snapshot");
    });

    it("should return 500 when restore fails", async () => {
      pm.restore.mockImplementation(() => {
        throw new Error("Corrupted data");
      });

      const res = await request(app).post("/state/restore");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Corrupted data");
    });
  });

  describe("GET /state/snapshots", () => {
    it("should return list of snapshots", async () => {
      const res = await request(app).get("/state/snapshots");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it("should pass limit parameter (capped at 100)", async () => {
      await request(app).get("/state/snapshots?limit=5");
      expect(pm.stateStore.listSnapshots).toHaveBeenCalledWith(5);
    });

    it("should cap limit at 100", async () => {
      await request(app).get("/state/snapshots?limit=200");
      expect(pm.stateStore.listSnapshots).toHaveBeenCalledWith(100);
    });

    it("should default to 20 when no limit provided", async () => {
      await request(app).get("/state/snapshots");
      expect(pm.stateStore.listSnapshots).toHaveBeenCalledWith(20);
    });

    it("should return 500 when listing fails", async () => {
      pm.stateStore.listSnapshots.mockImplementation(() => {
        throw new Error("DB error");
      });

      const res = await request(app).get("/state/snapshots");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("DB error");
    });
  });
});
