// Stand-in for dist/workers/map-build-child.mjs in MapBuildRunner tests. The
// request's `geofabrik` picks the behaviour.
import { spawn } from "node:child_process";
import fs from "node:fs";

process.once("message", (msg) => {
  const { geofabrik, outDir } = msg.options;
  const send = (m) => new Promise((resolve) => process.send(m, undefined, {}, resolve));
  if (geofabrik === "ok") {
    void (async () => {
      await send({ type: "progress", progress: { step: "download", progress: 0.5 } });
      await send({
        type: "done",
        result: { featureCount: 7, bbox: [0, 0, 1, 1], validation: {}, buildingCount: null },
      });
      process.exit(0);
    })();
  } else if (geofabrik === "error") {
    void send({ type: "error", message: "osmium failed" }).then(() => process.exit(0));
  } else if (geofabrik === "crash") {
    console.error("something went badly wrong");
    setTimeout(() => process.exit(3), 20);
  } else if (geofabrik === "hang") {
    // A grandchild in the same process group, like osmium.
    const grandchild = spawn("sleep", ["30"], { stdio: "ignore" });
    fs.writeFileSync(`${outDir}/grandchild.pid`, String(grandchild.pid));
    void send({ type: "progress", progress: { step: "extract", progress: 0.4 } });
  }
});
process.on("disconnect", () => process.exit(1));
