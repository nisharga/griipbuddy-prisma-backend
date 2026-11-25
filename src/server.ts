import "./instrument"; // must stay first: starts error tracking (Sentry)
import type { Server } from "http";
import config from "@/config";
import { logger } from "@/shared/logger";
import { flushSentry, reportError } from "@/shared/sentry";
import { prisma } from "@/shared/prisma";
import { closeRedis } from "@/shared/redis";
import { startWorker, stopJobs } from "@/jobs/queue";
import { startCron, stopCron } from "@/jobs/cron";
import { createApp } from "./app";

let server: Server | undefined;
let shuttingDown = false;

const main = async () => {
  await prisma.$connect();
  logger.info("database connected");
  if (config.otp.staticCode) {
    const numbers = config.otp.staticPhones.length ? config.otp.staticPhones.join(", ") : "EVERY number";
    logger.warn(`⚠ OTP_STATIC_CODE is on: ${numbers} can log in with the fixed code, no SMS. Testing only.`);
  }

  server = createApp().listen(config.port, () =>
    logger.info({ port: config.port, env: config.nodeEnv }, "🚀 API listening")
  );
  server.keepAliveTimeout = 65_000; // longer than typical load-balancer idle timeouts
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal(
        `Port ${config.port} is already in use — another copy of the API is probably running. ` +
          `Stop it with: lsof -ti:${config.port} | xargs kill   (or change PORT in .env)`
      );
      void shutdown("EADDRINUSE", 1);
      return;
    }
    throw err;
  });

  startWorker();
  startCron();
};

/** Stop accepting requests, finish in-flight ones, close jobs and connections, exit. */
const shutdown = async (signal: string, code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    stopCron();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await stopJobs();
    await closeRedis();
    await prisma.$disconnect();
    await flushSentry(); // send any queued error reports before exiting
  } finally {
    process.exit(code);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection");
  reportError(reason, { tags: { crash: "unhandledRejection" } });
  void shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  reportError(err, { tags: { crash: "uncaughtException" } });
  void shutdown("uncaughtException", 1);
});

main().catch(async (err) => {
  logger.fatal({ err }, "failed to start");
  reportError(err, { tags: { crash: "startup" } });
  await flushSentry();
  process.exit(1);
});
