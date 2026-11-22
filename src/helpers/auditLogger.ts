import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { logger } from "@/shared/logger";
import type { IAuthUser } from "@/interfaces/common";

/**
 * Record who did what (staff actions on orders, stock, products, staff, roles).
 * Fire-and-forget: an audit failure is logged but never fails the request.
 */
export const auditLog = (
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  meta?: Prisma.InputJsonValue
) => {
  const actor = req.user as IAuthUser | undefined;
  prisma.auditLog
    .create({ data: { actor_id: actor?.id, action, entity, entity_id: entityId, meta, ip: req.ip } })
    .catch((err) => logger.error({ err: err.message, action }, "audit log write failed"));
};
