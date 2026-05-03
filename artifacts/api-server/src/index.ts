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
  startNotificationJob();
  startAutoMiner();
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
