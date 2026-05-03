import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { startNotificationJob } from "./lib/pushNotifications";
import { startAutoMiner } from "./lib/autoMiner";
import { attachChatSocket } from "./socket/chat";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
attachChatSocket(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  if (!process.env["PRIVATE_OBJECT_DIR"] || !process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"]) {
    logger.warn("Object Storage env vars not set — avatar uploads will fail. Provision a bucket via the Object Storage tool.");
  }
  startNotificationJob();
  startAutoMiner();
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
