import type { Request } from "express";
import type { IMeta } from "@/interfaces/common";
import type { IPagination } from "@/interfaces/pagination";

/** ?page & ?limit with sane bounds (limit capped at 1000). */
const calculatePagination = (req: Request, defaultLimit = 10): IPagination => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const buildMeta = (p: IPagination, total: number): IMeta => ({
  page: p.page,
  limit: p.limit,
  total,
  totalPage: Math.ceil(total / p.limit),
});

export const paginationHelpers = { calculatePagination, buildMeta };
