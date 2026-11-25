import type { RequestHandler, RequestParamHandler } from "express";
import { z } from "zod/v3";
import { badRequest } from "@/errors/ApiError";

/**
 * Checks for the query string and URL params that every module shares, so each route
 * doesn't have to repeat them. Mounted once in routes/index.ts.
 *
 *   ?limit=abc            → 400 "limit must be a whole number"
 *   /brand/not-an-id      → 400 "Invalid id"   (no database query)
 *
 * For a route's own query fields, add `query` to its schema and use validateRequest
 * (see `listQuery` below and the README).
 */

/** Database ids are cuids, e.g. "cmh3k2x1p0000abcd1234efgh". */
export const id = (name = "id") =>
  z.string({ required_error: `${name} is required` }).regex(/^c[a-z0-9]{20,30}$/, `Invalid ${name}`);

/** URL params that always hold an id (`/:id`, `/:productId` …). Slugs, phones and refs are not checked. */
export const ID_PARAMS = ["id", "productId", "variantId", "categoryId"] as const;

/** Checks one id param before the route runs. Use with `router.param(name, checkIdParam)`. */
export const checkIdParam: RequestParamHandler = (_req, _res, next, value, name) => {
  next(id(name).safeParse(value).success ? undefined : badRequest(`Invalid ${name}.`, name));
};

/** "", "undefined" and "null" mean "not sent" (the frontends send these for empty filters). */
const blank = (v: unknown) => v === undefined || v === "" || v === "undefined" || v === "null";
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (blank(v) ? undefined : v), schema.optional());

const wholeNumber = (name: string, min: number, max: number) =>
  optional(
    z
      .string({ invalid_type_error: `${name} must be sent once` })
      .regex(/^\d+$/, `${name} must be a whole number`)
      .refine((v) => Number(v) >= min && Number(v) <= max, `${name} must be between ${min} and ${max}`)
  );

const number = (name: string) =>
  optional(
    z
      .string({ invalid_type_error: `${name} must be sent once` })
      .refine((v) => Number.isFinite(Number(v)), `${name} must be a number`)
  );

/** "YYYY-MM-DD" and a real date (2024-02-30 fails). */
const date = (name: string) =>
  optional(
    z
      .string({ invalid_type_error: `${name} must be sent once` })
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${name} must be a date like 2024-12-31`)
      .refine((v) => {
        const day = new Date(`${v}T00:00:00Z`);
        return !/^\d{4}-\d{2}-\d{2}$/.test(v) || (!isNaN(day.getTime()) && day.toISOString().startsWith(v));
      }, `${name} is not a real date`)
  );

/** Text a list can be searched by (one value, not an array or object). */
const text = (name: string) =>
  optional(z.string({ invalid_type_error: `${name} must be text` }).max(200, `${name} is too long`));

/**
 * Pagination, sorting, search, dates and number ranges.
 * Only checked when sent; anything else in the query string is left to the route.
 */
export const listQuery = z.object({
  page: wholeNumber("page", 1, 100_000),
  limit: wholeNumber("limit", 1, 1000),
  sortBy: optional(z.string().regex(/^[a-zA-Z_.]{1,50}$/, "sortBy must be a field name")),
  sortOrder: optional(z.enum(["asc", "desc"], { message: "sortOrder must be asc or desc" })),
  searchTerm: text("searchTerm"),
  searchQuery: text("searchQuery"),
  search: text("search"),
  q: text("q"),
  startDate: date("startDate"),
  endDate: date("endDate"),
  min_price: number("min_price"),
  max_price: number("max_price"),
  minPrice: number("minPrice"),
  maxPrice: number("maxPrice"),
  minQty: number("minQty"),
  maxQty: number("maxQty"),
  stockMovementsLimit: wholeNumber("stockMovementsLimit", 1, 1000),
});

/** 400 when a shared query field is wrong (e.g. ?limit=abc or ?startDate=yesterday). */
export const checkListQuery: RequestHandler = (req, _res, next) => {
  const result = listQuery.safeParse(req.query);
  next(result.success ? undefined : result.error);
};
