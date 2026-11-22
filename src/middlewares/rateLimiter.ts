import { rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "@/shared/redis";
import config, { RATE_LIMITS } from "@/config";

/**
 * Rate limiters. With Redis the counters are shared by every API instance;
 * without it each instance counts in memory. Disabled in tests.
 */
const make = (name: keyof typeof RATE_LIMITS) => {
  const { windowMs, limit, message } = RATE_LIMITS[name];
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => config.isTest,
    // Default key = client IP (via `trust proxy`), with IPv6 addresses grouped by /56 subnet.
    ...(redis
      ? {
          store: new RedisStore({
            prefix: `rl:${name}:`,
            // ioredis' generic `call` returns unknown; the store only needs the raw reply.
            sendCommand: (command: string, ...args: string[]) => redis!.call(command, ...args) as never,
          }),
        }
      : {}),
    handler: (_req, res, _next, options: Options) => {
      res
        .status(429)
        .json({ statusCode: 429, success: false, message, errorMessages: [{ path: "", message }] });
      void options;
    },
  });
};

/** Every API request: generous, stops abuse. */
export const globalLimiter = make("global");
/** Login / password endpoints. */
export const authLimiter = make("auth");
/** Public order placement and payment-proof uploads. */
export const orderLimiter = make("order");
/** Storefront product questions. */
export const faqLimiter = make("faq");
/** Storefront reviews and helpful votes. */
export const reviewLimiter = make("review");
