/**
 * App settings that are not read from .env (fixed in code, same in every
 * environment). Environment variables live in ./env.ts.
 */

export const APP_NAME = "GriipBuddy";

/** Every API route is mounted under this prefix. */
export const API_PREFIX = "/api/v1";

/** Max size of a JSON / form request body (file uploads are limited separately). */
export const BODY_SIZE_LIMIT = "2mb";

/** Browser cache time for files served from local disk at /uploads. */
export const LOCAL_UPLOADS_CACHE = "7d";

/** Max file size per upload type, in MB. */
export const UPLOAD_LIMITS_MB = {
  media: 10, // admin images (and short videos)
  video: 200,
  paymentProof: 5, // checkout screenshots (public)
} as const;

/** Files bigger than this are sent to Cloudinary in chunks (required for large videos). */
export const CLOUDINARY_CHUNK_SIZE = 20 * 1024 * 1024;

/** Customer phone + OTP login. */
export const OTP = {
  length: 6,
  expiresInSeconds: 5 * 60,
  /** Wait this long before asking for another code. */
  resendAfterSeconds: 60,
  /** Codes one phone number can request per hour. */
  maxPerHour: 5,
  /** Wrong guesses before a code stops working. */
  maxAttempts: 5,
} as const;

const MINUTE = 60_000;

/** Rate limits per client IP: `limit` requests per `windowMs`. */
export const RATE_LIMITS = {
  global: { windowMs: MINUTE, limit: 300, message: "Too many requests. Please slow down." },
  auth: { windowMs: MINUTE, limit: 10, message: "Too many login attempts. Please try again in a minute." },
  order: {
    windowMs: 10 * MINUTE,
    limit: 20,
    message: "Too many orders from this network. Please try again later.",
  },
  otp: {
    windowMs: 10 * MINUTE,
    limit: 10,
    message: "Too many code requests from this network. Please try again later.",
  },
  faq: {
    windowMs: 10 * MINUTE,
    limit: 10,
    message: "Too many questions from this network. Please try again later.",
  },
  review: {
    windowMs: 10 * MINUTE,
    limit: 30,
    message: "Too many review requests from this network. Please try again later.",
  },
} as const;
