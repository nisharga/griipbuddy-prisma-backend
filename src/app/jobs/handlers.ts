import { sendSms } from "@/helpers/smsSender";

/**
 * Background job handlers, keyed by job name. Add a job by adding a handler here
 * and calling `enqueue("<name>", data)`.
 */
export const handlers = {
  "sms.send": async (data: { to: string; message: string }) => {
    await sendSms(data.to, data.message);
  },
} satisfies Record<string, (data: never) => Promise<void>>;

export type JobName = keyof typeof handlers;
export type JobData<N extends JobName> = Parameters<(typeof handlers)[N]>[0];
