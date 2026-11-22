// Load .env into process.env (same as `import "dotenv/config"`, whose types
// only resolve under node16/bundler module resolution).
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import { z } from "zod";

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
  SERVER_BASE_URL: optional,
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
  CLOUDINARY_FOLDER: z.string().default("uploads"),

  SMS_API_KEY: optional,
  SMS_SENDER_ID: optional,
  SMS_BASE_URL: z.string().url().default("http://bulksmsbd.net/api/smsapi"),

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

export const env = {
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === "production",
  isTest: e.NODE_ENV === "test",
  port: e.PORT,
  logLevel: e.NODE_ENV === "test" ? "silent" : e.LOG_LEVEL,
  serverBaseUrl: (e.SERVER_BASE_URL ?? `http://localhost:${e.PORT}`).replace(/\/$/, ""),
  corsOrigins: e.CORS_ORIGINS,
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
          folder: e.CLOUDINARY_FOLDER.replace(/^\/+|\/+$/g, ""),
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
  sms:
    e.SMS_API_KEY && e.SMS_SENDER_ID
      ? { apiKey: e.SMS_API_KEY, senderId: e.SMS_SENDER_ID, baseUrl: e.SMS_BASE_URL }
      : undefined,
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
