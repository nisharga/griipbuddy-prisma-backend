import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains, numberRange } from "@/helpers/queryHelper";
import { filterWhere, paginate } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";

/**
 * Products for the storefront (public). Only published, non-deleted products are
 * shown. The admin's product functions live in ./product.service.ts.
 */

/** Products a shopper can see. */
const LIVE = { is_deleted: false, is_published: true } as const;

/** What a storefront product response includes. */
const PUBLIC_INCLUDE = {
  category: {
    select: {
      id: true,
      name_en: true,
      name_bn: true,
      slug: true,
      subcategories: { where: { subcategory_id: null }, select: { id: true, name_en: true, slug: true } },
    },
  },
  subcategory: { select: { id: true, name_en: true, name_bn: true, slug: true } },
  brand: { select: { id: true, name: true } },
  return_policy: {
    select: { id: true, title: true, description: true, return_period_days: true, conditions: true },
  },
  variants: { orderBy: [{ serial: "asc" as const }, { createdAt: "asc" as const }] },
} satisfies Prisma.ProductInclude;

/** Collection slugs that aren't real sub-categories. */
const SPECIAL_COLLECTIONS = new Set(["best-selling", "top-selling", "all", "all-products", "new-arrivals"]);

type PublicListFilters = {
  search?: string;
  category?: string;
  subcategory?: string;
  min_price?: number;
  max_price?: number;
  sortBy?: string;
  sortOrder: "asc" | "desc";
  top_selling?: boolean;
};

/** The sort order for the shop's product lists. */
const publicOrderBy = (
  filters: PublicListFilters,
  topSelling: boolean
): Prisma.ProductOrderByWithRelationInput[] => {
  if (topSelling) return [{ total_sold: "desc" }, { createdAt: "desc" }];
  if (filters.sortBy === "price" || filters.sortBy === "sale_price") {
    return [{ min_price: filters.sortOrder }, { id: "asc" }];
  }
  if (filters.sortBy === "name") return [{ name: filters.sortOrder }, { id: "asc" }];
  return [{ createdAt: filters.sortOrder }, { id: "asc" }];
};

/**
 * The shop's product list: by category / sub-category (id or slug), search,
 * price range and sort. "best-selling" / "top-selling" sort by units sold.
 */
const listPublic = async (pagination: IPagination, filters: PublicListFilters) => {
  const emptyResult = { products: [], data: [], meta: paginationHelpers.buildMeta(pagination, 0) };
  const where: Prisma.ProductWhereInput = {
    ...LIVE,
    ...filterWhere<Prisma.ProductWhereInput>({
      min_price: numberRange(filters.min_price, filters.max_price),
    }),
  };

  if (filters.category) {
    const category = await prisma.category.findFirst({
      where: { OR: [{ id: filters.category }, { slug: filters.category }] },
      select: { id: true },
    });
    if (!category) return emptyResult;
    where.category_id = category.id;
  }

  if (filters.subcategory && !SPECIAL_COLLECTIONS.has(filters.subcategory)) {
    const subcategory = await prisma.subCategory.findFirst({
      where: { OR: [{ id: filters.subcategory }, { slug: filters.subcategory }] },
      select: { id: true },
    });
    if (!subcategory) return emptyResult;
    // A product matches its sub-category or its sub-sub-category.
    where.OR = [{ subcategory_id: subcategory.id }, { sub_subcategory_id: subcategory.id }];
  }

  if (filters.search) {
    // In AND, so it doesn't replace the sub-category OR above.
    where.AND = [
      {
        OR: [
          { name: contains(filters.search) },
          { sku: contains(filters.search) },
          { search_tags: { has: filters.search } },
        ],
      },
    ];
  }

  const topSelling =
    !!filters.top_selling || filters.subcategory === "best-selling" || filters.subcategory === "top-selling";
  const orderBy = publicOrderBy(filters, topSelling);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.product.findMany({ where, include: PUBLIC_INCLUDE, orderBy, ...page }),
    count: () => prisma.product.count({ where }),
  });
  return { products: result.data, data: result.data, meta: result.meta };
};

/**
 * Published products in a shuffled order for the home page's infinite scroll.
 * The shuffle is keyed to the day (UTC): every page of one scroll uses the same
 * order (no repeats, nothing skipped), and the feed changes daily.
 */
const listRandom = async (pagination: IPagination) => {
  const todaySeed = new Date().toISOString().slice(0, 10);

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM products
    WHERE is_deleted = false AND is_published = true
    ORDER BY md5(id || ${todaySeed})
    LIMIT ${pagination.limit} OFFSET ${pagination.skip}`;
  const total = await prisma.product.count({ where: LIVE });

  // Load the full products, then put them back in the shuffled order.
  const ids = rows.map((row) => row.id);
  const found = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, include: PUBLIC_INCLUDE })
    : [];
  const byId = new Map(found.map((product) => [product.id, product]));
  const products = ids.flatMap((id) => byId.get(id) ?? []);

  const meta = {
    ...paginationHelpers.buildMeta(pagination, total),
    total_pages: Math.ceil(total / pagination.limit),
  };
  return { products, data: products, meta };
};

/** One published product by slug or id. */
const getPublicBySlug = async (slugOrId: string) => {
  const product = await prisma.product.findFirst({
    where: { ...LIVE, OR: [{ slug: slugOrId }, { id: slugOrId }] },
    include: PUBLIC_INCLUDE,
  });
  if (!product) throw notFound("Product");
  return { product };
};

/** Several published products by id (e.g. the cart). */
const getPublicByIds = async (ids: string[]) => {
  if (!ids.length) return [];
  const result = await prisma.product.findMany({
    where: { ...LIVE, id: { in: ids } },
    include: PUBLIC_INCLUDE,
  });
  return result;
};

export const ProductPublicService = { listPublic, listRandom, getPublicBySlug, getPublicByIds };
