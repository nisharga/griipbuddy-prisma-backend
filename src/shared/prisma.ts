import { PrismaClient } from "@prisma/client";
import config from "@/config";
import { logger } from "./logger";

const createClient = () => {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });
  client.$on("warn", (e) => logger.warn({ prisma: e.message }, "prisma warning"));
  client.$on("error", (e) => logger.error({ prisma: e.message }, "prisma error"));
  return client;
};

/**
 * One PrismaClient for the whole process (each client owns a connection pool).
 * In development it's cached on globalThis so hot reloads don't leak pools.
 */
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };
export const prisma = globalForPrisma.prisma ?? createClient();
if (!config.isProd) globalForPrisma.prisma = prisma;

/** A client usable both standalone and inside `prisma.$transaction(async (tx) => …)`. */
export type Db = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
