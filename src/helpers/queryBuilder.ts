import type { IPagination } from "@/interfaces/pagination";
import { paginationHelpers } from "./paginationHelper";
import { contains } from "./queryHelper";

/**
 * Reusable search / filter / sort / pagination for Prisma list queries.
 *
 *   const where = {
 *     ...filterWhere<Prisma.BrandWhereInput>({ is_active: filters.active }),
 *     ...searchWhere<Prisma.BrandWhereInput>(search, ["name", "slug"]),
 *   };
 *   const orderBy = sortBy(pagination, ["name", "createdAt"], NEWEST_FIRST);
 *   return paginate(pagination, {
 *     findMany: (page) => prisma.brand.findMany({ where, orderBy, ...page }),
 *     count: () => prisma.brand.count({ where }),
 *   });
 */

/** The default order for most lists. */
export const NEWEST_FIRST = { createdAt: "desc" } as const;

/** "product.name" + value → { product: { name: value } } */
const nested = (path: string, value: unknown): Record<string, unknown> =>
  path.split(".").reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;

/**
 * Search one text across several fields (case-insensitive "contains").
 * Use dotted paths for relations, e.g. "product.name". No text → no filter.
 */
export const searchWhere = <Where>(search: string | undefined, fields: string[]): Where => {
  if (!search) return {} as Where;
  return { OR: fields.map((field) => nested(field, contains(search))) } as Where;
};

/** Exact-match filters. Empty values (undefined, null, "") are skipped. */
export const filterWhere = <Where>(filters: Record<string, unknown>): Where => {
  const where: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    where[field] = value;
  }
  return where as Where;
};

/**
 * The client's ?sortBy / ?sortOrder, but only for fields in `allowed`
 * (so nobody can sort by hidden columns). Otherwise the `fallback` order.
 */
export const sortBy = <OrderBy>(pagination: IPagination, allowed: string[], fallback: OrderBy): OrderBy => {
  if (pagination.sortBy && allowed.includes(pagination.sortBy)) {
    return { [pagination.sortBy]: pagination.sortOrder } as OrderBy;
  }
  return fallback;
};

/** Fetch one page and the total count together → `{ data, meta }`. */
export const paginate = async <Row>(
  pagination: IPagination,
  query: {
    findMany: (page: { skip: number; take: number }) => Promise<Row[]>;
    count: () => Promise<number>;
  }
) => {
  const [data, total] = await Promise.all([
    query.findMany({ skip: pagination.skip, take: pagination.limit }),
    query.count(),
  ]);
  return { data, meta: paginationHelpers.buildMeta(pagination, total) };
};
