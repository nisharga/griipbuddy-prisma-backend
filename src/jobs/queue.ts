import { Queue, Worker } from "bullmq";
import { redis } from "@/shared/redis";
import { logger } from "@/shared/logger";
import { handlers, type JobData, type JobName } from "./handlers";

/**
 * Background jobs. With Redis: a BullMQ queue (retries with backoff, survives
 * restarts, runs off the request path). Without Redis: the handler runs in the
 * background of the current process. Callers don't need to know which.
 */
const QUEUE = "griipbuddy-jobs";

const queue = redis ? new Queue(QUEUE, { connection: redis }) : null;
let worker: Worker | null = null;

export const enqueue = async <N extends JobName>(name: N, data: JobData<N>): Promise<void> => {
  if (queue) {
    await queue
      .add(name, data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      })
      .catch((err) => logger.error({ job: name, err: err.message }, "enqueue failed"));
    return;
  }
  setImmediate(() => {
    (handlers[name] as (d: JobData<N>) => Promise<void>)(data).catch((err) =>
      logger.error({ job: name, err: (err as Error).message }, "inline job failed")
    );
  });
};

/** Start processing jobs (call once at boot). No-op without Redis. */
export const startWorker = () => {
  if (!redis || worker) return;
  worker = new Worker(
    QUEUE,
    async (job) => {
      const handler = handlers[job.name as JobName] as ((d: unknown) => Promise<void>) | undefined;
      if (!handler) throw new Error(`No handler for job "${job.name}"`);
      await handler(job.data);
    },
    { connection: redis.duplicate({ maxRetriesPerRequest: null }), concurrency: 5 }
  );
  worker.on("failed", (job, err) => logger.error({ job: job?.name, err: err.message }, "job failed"));
  logger.info("job worker started");
};

export const stopJobs = async () => {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
};
