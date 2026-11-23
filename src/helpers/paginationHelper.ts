import type { Request } from "express";
import type { IMeta } from "@/interfaces/common";
import type { IPagination } from "@/interfaces/pagination";

/** ?page, ?limit (capped at 1000), ?sortBy and ?sortOrder from the request. */
const calculatePagination = (req: Request, defaultLimit = 10): IPagination => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || defaultLimit));

  const sortBy =
    typeof req.query.sortBy === "string" && req.query.sortBy.trim() ? req.query.sortBy.trim() : undefined;
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

  return { page, limit, skip: (page - 1) * limit, sortBy, sortOrder };
};

/** The `meta` block of a paged response. */
const buildMeta = (pagination: { page: number; limit: number }, total: number): IMeta => ({
  page: pagination.page,
  limit: pagination.limit,
  total,
  totalPage: Math.ceil(total / pagination.limit),
});

export const paginationHelpers = { calculatePagination, buildMeta };
