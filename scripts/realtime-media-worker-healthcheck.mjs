const port = process.env.REALTIME_WORKER_PORT || "8787";
const url = `http://127.0.0.1:${port}/healthz`;

try {
  const response = await fetch(url);
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
