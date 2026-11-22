import { rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "@/shared/redis";
import config from "@/config";

/**
 * Rate limiters. With Redis the counters are shared by every API instance;
 * without it each instance counts in memory. Disabled in tests.
 */
const make = (name: string, windowMs: number, limit: number, message: string) =>
  rateLimit({
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

/** Every API request: generous, stops abuse. */
export const globalLimiter = make("global", 60_000, 300, "Too many requests. Please slow down.");
/** Login / password endpoints. */
export const authLimiter = make("auth", 60_000, 10, "Too many login attempts. Please try again in a minute.");
/** Public order placement and payment-proof uploads. */
export const orderLimiter = make(
  "order",
  10 * 60_000,
  20,
  "Too many orders from this network. Please try again later."
);
/** Storefront product questions. */
export const faqLimiter = make(
  "faq",
  10 * 60_000,
  10,
  "Too many questions from this network. Please try again later."
);
/** Storefront reviews and helpful votes. */
export const reviewLimiter = make(
  "review",
  10 * 60_000,
  30,
  "Too many review requests from this network. Please try again later."
);
