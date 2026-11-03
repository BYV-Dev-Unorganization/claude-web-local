import { config, isAgentProviderConfigured } from "./config.js";
import { sqlite } from "./db.js";
import { startAgentWorkers, stopAgentWorkers } from "./agent-worker.js";

if (config.AGENT_WORKER_MODE !== "external") {
  throw new Error("Set AGENT_WORKER_MODE=external before starting the standalone worker process.");
}
if (!isAgentProviderConfigured()) {
  throw new Error("The external worker requires provider credentials and at least one configured model alias.");
}

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await stopAgentWorkers();
  sqlite.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

startAgentWorkers((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("[agent-worker] " + message + "\n");
});
process.stdout.write("[agent-worker] started pid=" + process.pid + " concurrency=" + config.WORKER_CONCURRENCY + "\n");
