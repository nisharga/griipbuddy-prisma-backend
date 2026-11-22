import Redis from "ioredis";
import config from "@/config";
import { logger } from "./logger";

/**
 * Optional Redis connection (rate-limit store + BullMQ). `null` when REDIS_URL is
 * not set — callers fall back to in-memory / inline behaviour.
 */
export const redis: Redis | null = config.redisUrl
  ? new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false })
  : null;

if (redis) {
  redis.on("ready", () => logger.info("redis connected"));
  redis.on("error", (err) => logger.error({ err: err.message }, "redis error"));
}

export const closeRedis = async () => {
  if (redis && redis.status !== "end") await redis.quit().catch(() => undefined);
};
