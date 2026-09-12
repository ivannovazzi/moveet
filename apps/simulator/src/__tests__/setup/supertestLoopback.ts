/**
 * Makes supertest connect on the same address family it listened on.
 *
 * Why this exists (fleetsim-all-vtwk.13):
 *
 * `request(app)` calls `app.listen(0)` with no host and then hard-codes its URL
 * as `http://127.0.0.1:<port>`. Those two halves disagree about the address
 * family. A hostless `listen(0)` binds the IPv6 wildcard `::` (dual-stack), so
 * the kernel picks the ephemeral port out of the IPv6 table — where it cannot
 * see sockets that some *other* local process has bound IPv4-only on
 * `127.0.0.1`. `listen(0)` therefore happily hands back a port that is already
 * occupied on IPv4 loopback, and supertest's IPv4 connect lands on that foreign
 * process instead of on the test's own server.
 *
 * Diagnosed by dumping the raw bytes that came back on a failing connection:
 * they were a MySQL 8.0.33 handshake greeting from an unrelated local server,
 * not HTTP. llhttp reports that as `Parse Error: Expected HTTP/, RTSP/ or ICE/`,
 * which is the intermittent failure this fixes. Nothing was actually crossed
 * between vitest workers — the workers only make it frequent, because the 23
 * supertest files draw hundreds of ephemeral ports per run in parallel and one
 * of them eventually lands on an occupied one.
 *
 * Connecting to `[::1]` when the server bound IPv6 closes the hole: that port
 * came from the IPv6 table, so the kernel guarantees no other process holds it,
 * and the connection can only reach our own server. Every route test keeps
 * running in parallel — no serialisation, no shared-server bookkeeping, no
 * retries.
 *
 * Rewriting the *bind* to `127.0.0.1` instead would also close the race, but it
 * breaks supertest: a host argument sends `listen()` through an asynchronous
 * DNS lookup, and supertest reads `app.address().port` synchronously on the
 * next line, so it sees `null`.
 */
import type { AddressInfo, Server } from "node:net";
import supertest from "supertest";

type ServerAddressFn = (this: unknown, app: Server, path: string) => string;

interface SupertestModule {
  Test: { prototype: { serverAddress: ServerAddressFn } };
}

const PATCHED = Symbol.for("moveet.supertestLoopback.patched");

const proto = (supertest as unknown as SupertestModule).Test.prototype as {
  serverAddress: ServerAddressFn;
  [PATCHED]?: boolean;
};

// vitest loads setup files once per test file, but the supertest module is
// shared across the worker, so guard against wrapping the same function twice.
if (!proto[PATCHED]) {
  proto[PATCHED] = true;

  const original = proto.serverAddress;

  proto.serverAddress = function serverAddress(this: unknown, app: Server, path: string): string {
    const url = original.call(this, app, path);
    const addr = app.address() as AddressInfo | string | null;

    if (addr && typeof addr === "object" && addr.family === "IPv6") {
      return url.replace("://127.0.0.1:", "://[::1]:");
    }

    return url;
  };
}
