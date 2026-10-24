#!/usr/bin/env node
import {
  buildWorkerConfig,
  createRealtimeMediaWorkerServer,
  sanitizeError,
} from "./realtime-media-worker-core.mjs";

// Last-resort backstop: a stray rejection from any single stream must never
// crash the process and take down every active call's realtime features. Per
// the runbook, worker errors fail only the realtime feature they belong to.
process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "unhandled_rejection",
      error: sanitizeError(reason),
      at: new Date().toISOString(),
    })
  );
});

const config = buildWorkerConfig();
const { httpServer } = createRealtimeMediaWorkerServer({ config });

httpServer.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "realtime_media_worker_listening",
      port: config.port,
      path: "/twilio/media-stream",
      at: new Date().toISOString(),
    })
  );
});

function shutdown() {
  httpServer.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
