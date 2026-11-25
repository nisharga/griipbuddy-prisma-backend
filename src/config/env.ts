// Load .env into process.env (same as `import "dotenv/config"`, whose types
// only resolve under node16/bundler module resolution).
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { z } from "zod/v3";

/**
 * Every environment variable is read here, once, and validated at boot.
 * A missing or malformed value stops the process with a clear message instead
 * of failing later at runtime. Optional integrations (Redis, Cloudinary, S3, SMS, SMTP)
 * switch themselves off when their variables are empty.
 */
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5007),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Error tracking (optional). Empty SENTRY_DSN = off.
  SENTRY_DSN: optional,
  SENTRY_ENVIRONMENT: optional,
  // Share of requests to trace for performance (0 = errors only, which fits the free plan).
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SERVER_BASE_URL: optional,
  // API docs at /docs: "true" / "false". Empty = on, except in production.
  API_DOCS: z.enum(["true", "false", ""]).optional(),
  CORS_ORIGINS: csv,
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  DATABASE_URL: z.string().url("DATABASE_URL must be a postgres connection URL"),
  REDIS_URL: optional,

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("1d"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("365d"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  DELIVERY_CHARGE_INSIDE_DHAKA: z.coerce.number().min(0).default(80),
  DELIVERY_CHARGE_OUTSIDE_DHAKA: z.coerce.number().min(0).default(120),

  AWS_ACCESS_KEY_ID: optional,
  AWS_SECRET_ACCESS_KEY: optional,
  AWS_REGION: optional,
  AWS_BUCKET_NAME: optional,
  AWS_FILE_LOAD_BASE_URL: optional,

  CLOUDINARY_CLOUD_NAME: optional,
  CLOUDINARY_API_KEY: optional,
  CLOUDINARY_API_SECRET: optional,

  // Fixed login code for testing without SMS (empty = real random codes).
  OTP_STATIC_CODE: optional.refine((v) => v === undefined || /^\d{6}$/.test(v), "Must be 6 digits."),
  // Limit the fixed code to these numbers (comma-separated). Empty = every number.
  OTP_STATIC_PHONES: csv,

  SMS_PROVIDER: z.enum(["alpha", "bulksmsbd"]).default("alpha"),
  SMS_API_KEY: optional,
  SMS_SENDER_ID: optional,
  SMS_BASE_URL: optional,

  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_SECURE: bool,
  SMTP_FROM_NAME: z.string().default("GriipBuddy"),
  SMTP_FROM_EMAIL: optional,

  CRON_ENABLED: bool.default("true"),
  ADMIN_ALERT_EMAILS: csv,
  LOW_STOCK_THRESHOLD: z.coerce.number().int().min(0).default(5),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
  // Logger isn't available yet (it depends on this file).
  process.stderr.write(`\n❌ Invalid environment configuration:\n${problems}\n\nSee .env.example.\n\n`);
  process.exit(1);
}

const e = parsed.data;

/** Each SMS provider's send URL (SMS_BASE_URL overrides it, e.g. for the fake SMS server). */
const SMS_URLS = {
  alpha: "https://api.sms.net.bd/sendsms",
  bulksmsbd: "http://bulksmsbd.net/api/smsapi",
} as const;

/** SMS settings, or undefined when SMS is off. BulkSMSBD also needs a sender ID. */
const smsConfig = (vars: typeof e) => {
  if (!vars.SMS_API_KEY) return undefined;
  if (vars.SMS_PROVIDER === "bulksmsbd" && !vars.SMS_SENDER_ID) return undefined;
  return {
    provider: vars.SMS_PROVIDER,
    apiKey: vars.SMS_API_KEY,
    senderId: vars.SMS_SENDER_ID,
    baseUrl: vars.SMS_BASE_URL ?? SMS_URLS[vars.SMS_PROVIDER],
  };
};

export const env = {
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === "production",
  isTest: e.NODE_ENV === "test",
  port: e.PORT,
  logLevel: e.NODE_ENV === "test" ? "silent" : e.LOG_LEVEL,
  sentry:
    e.SENTRY_DSN && e.NODE_ENV !== "test"
      ? {
          dsn: e.SENTRY_DSN,
          environment: e.SENTRY_ENVIRONMENT ?? e.NODE_ENV,
          tracesSampleRate: e.SENTRY_TRACES_SAMPLE_RATE,
        }
      : undefined,
  serverBaseUrl: (e.SERVER_BASE_URL ?? `http://localhost:${e.PORT}`).replace(/\/$/, ""),
  corsOrigins: e.CORS_ORIGINS,
  apiDocs: e.API_DOCS ? e.API_DOCS === "true" : e.NODE_ENV !== "production",
  trustProxy: e.TRUST_PROXY,
  databaseUrl: e.DATABASE_URL,
  redisUrl: e.REDIS_URL,
  jwt: {
    accessSecret: e.JWT_ACCESS_SECRET,
    accessExpiresIn: e.JWT_ACCESS_EXPIRES_IN,
    refreshSecret: e.JWT_REFRESH_SECRET,
    refreshExpiresIn: e.JWT_REFRESH_EXPIRES_IN,
  },
  bcryptRounds: e.BCRYPT_SALT_ROUNDS,
  delivery: { insideDhaka: e.DELIVERY_CHARGE_INSIDE_DHAKA, outsideDhaka: e.DELIVERY_CHARGE_OUTSIDE_DHAKA },
  cloudinary:
    e.CLOUDINARY_CLOUD_NAME && e.CLOUDINARY_API_KEY && e.CLOUDINARY_API_SECRET
      ? {
          cloudName: e.CLOUDINARY_CLOUD_NAME,
          apiKey: e.CLOUDINARY_API_KEY,
          apiSecret: e.CLOUDINARY_API_SECRET,
        }
      : undefined,
  s3:
    e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY && e.AWS_REGION && e.AWS_BUCKET_NAME
      ? {
          accessKeyId: e.AWS_ACCESS_KEY_ID,
          secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
          region: e.AWS_REGION,
          bucket: e.AWS_BUCKET_NAME,
          publicBaseUrl: (
            e.AWS_FILE_LOAD_BASE_URL ?? `https://${e.AWS_BUCKET_NAME}.s3.${e.AWS_REGION}.amazonaws.com`
          ).replace(/\/$/, ""),
        }
      : undefined,
  sms: smsConfig(e),
  otp: { staticCode: e.OTP_STATIC_CODE, staticPhones: e.OTP_STATIC_PHONES },
  smtp:
    e.SMTP_HOST && e.SMTP_USER
      ? {
          host: e.SMTP_HOST,
          port: e.SMTP_PORT,
          user: e.SMTP_USER,
          pass: e.SMTP_PASS ?? "",
          secure: e.SMTP_SECURE,
          fromName: e.SMTP_FROM_NAME,
          fromEmail: e.SMTP_FROM_EMAIL ?? e.SMTP_USER,
        }
      : undefined,
  cron: {
    enabled: e.CRON_ENABLED && e.NODE_ENV !== "test",
    adminAlertEmails: e.ADMIN_ALERT_EMAILS,
    lowStockThreshold: e.LOW_STOCK_THRESHOLD,
    auditRetentionDays: e.AUDIT_LOG_RETENTION_DAYS,
  },
} as const;
