import cron, { type ScheduledTask } from "node-cron";
import config from "@/config";
import { logger } from "@/shared/logger";
import { reportError } from "@/shared/sentry";
import { prisma } from "@/shared/prisma";
import { sendEmail } from "@/helpers/emailSender";

/**
 * Scheduled jobs (Asia/Dhaka time). Each run takes a Postgres advisory lock, so
 * when the API runs on several servers/containers only one executes the job.
 */
const TZ = "Asia/Dhaka";
const tasks: ScheduledTask[] = [];

const withLock = async (name: string, lockKey: number, fn: () => Promise<void>) => {
  const [{ locked }] = await prisma.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_lock(${lockKey}) AS locked`;
  if (!locked) return logger.debug({ job: name }, "cron skipped (running elsewhere)");
  const started = Date.now();
  try {
    await fn();
    logger.info({ job: name, ms: Date.now() - started }, "cron done");
  } catch (err) {
    logger.error({ job: name, err: (err as Error).message }, "cron failed");
    reportError(err, { tags: { cron: name } });
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
  }
};

/** Daily email to ADMIN_ALERT_EMAILS listing variants at or below LOW_STOCK_THRESHOLD. */
export const lowStockDigest = async () => {
  if (!config.cron.adminAlertEmails.length) return;
  const rows = await prisma.$queryRaw<{ product: string; sku: string; available: bigint }[]>`
    SELECT p.name AS product, v.sku, SUM(s.available_quantity) AS available
    FROM stocks s
    JOIN product_variants v ON v.id = s.variant_id
    JOIN products p ON p.id = s.product_id
    WHERE p.is_deleted = false AND p.is_published = true
    GROUP BY p.name, v.sku
    HAVING SUM(s.available_quantity) <= ${config.cron.lowStockThreshold}
    ORDER BY available ASC, p.name ASC
    LIMIT 200`;
  if (!rows.length) return;
  await sendEmail({
    to: config.cron.adminAlertEmails,
    subject: `Low stock: ${rows.length} item(s) at or below ${config.cron.lowStockThreshold}`,
    template: "low-stock",
    data: {
      threshold: config.cron.lowStockThreshold,
      items: rows.map((r) => ({ ...r, available: Number(r.available) })),
    },
  });
};

/** Delete audit-log rows older than AUDIT_LOG_RETENTION_DAYS. */
export const pruneAuditLogs = async () => {
  const cutoff = new Date(Date.now() - config.cron.auditRetentionDays * 86_400_000);
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (count) logger.info({ count }, "audit logs pruned");
};

export const startCron = () => {
  if (!config.cron.enabled) return;
  tasks.push(
    cron.schedule("0 9 * * *", () => withLock("low-stock-digest", 9101, lowStockDigest), { timezone: TZ }),
    cron.schedule("30 3 * * *", () => withLock("prune-audit-logs", 9102, pruneAuditLogs), { timezone: TZ })
  );
  logger.info({ jobs: tasks.length }, "cron scheduled");
};

export const stopCron = () => {
  for (const t of tasks) void t.stop();
  tasks.length = 0;
};
