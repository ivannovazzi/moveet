import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type { AddressInfo, Server } from "node:net";

/**
 * Guards the setup file next to this one (see it for the full diagnosis of
 * fleetsim-all-vtwk.13). If the patch stops being applied — setup file dropped
 * from vitest.config.ts, supertest internals renamed — supertest silently goes
 * back to connecting to `127.0.0.1` on a port it allocated in the IPv6 table,
 * and the cross-process port collision comes back as a rare "Parse Error:
 * Expected HTTP/, RTSP/ or ICE/". That is exactly the kind of failure nobody
 * traces twice, so assert it here where it fails loudly instead.
 */
describe("supertest loopback setup", () => {
  const app = express();
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });

  it("connects on the address family the server actually bound", async () => {
    const test = request(app).get("/ping");
    const server = test.app as unknown as Server;
    const address = server.address() as AddressInfo | string | null;
    const family = address && typeof address === "object" ? address.family : "unknown";

    if (family === "IPv6") {
      expect(test.url).toMatch(/^http:\/\/\[::1\]:\d+\/ping$/);
    } else {
      // No IPv6 on this host: the hostless listen fell back to 0.0.0.0, so the
      // IPv4 URL supertest builds already matches the bind.
      expect(test.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ping$/);
    }

    const res = await test;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
