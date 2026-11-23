import type { Category, Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { notId } from "@/helpers/queryHelper";
import { paginate, sortBy } from "@/helpers/queryBuilder";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

/** Categories (top level of the catalog). Each one lists its sub-categories. */

// Only these fields can be set from the request body.
const FIELDS = [
  "name_en",
  "name_bn",
  "description_en",
  "description_bn",
  "image_url",
  "media",
  "position",
  "is_published",
] as const;

/** Display order: by `position`, then oldest first. */
const ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }];

/** Include the direct sub-categories and their own children (2 levels). */
const WITH_SUBCATEGORIES = {
  subcategories: {
    where: { subcategory_id: null },
    orderBy: ORDER,
    include: { sub_subcategories: { orderBy: ORDER } },
  },
};

/** A URL slug from the name that no other category uses. */
const makeSlug = (name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) => prisma.category.count({ where: { slug, ...notId(exceptId) } }));

// ---------------------------------------------------------------- read

/** Paged list. Shoppers only see published categories; staff see all. Sort: name_en, position, createdAt. */
const getAll = async (pagination: IPagination, includeUnpublished: boolean) => {
  const where: Prisma.CategoryWhereInput = {};
  if (!includeUnpublished) where.is_published = true;
  const orderBy = sortBy<Prisma.CategoryOrderByWithRelationInput | typeof ORDER>(
    pagination,
    ["name_en", "position", "createdAt"],
    ORDER
  );

  const result = await paginate(pagination, {
    findMany: (page) => prisma.category.findMany({ where, include: WITH_SUBCATEGORIES, orderBy, ...page }),
    count: () => prisma.category.count({ where }),
  });
  return { meta: result.meta, data: result.data };
};

/** Storefront navbar / home: every published category with sub-categories (no paging). */
const getPublished = async () => {
  const data = await prisma.category.findMany({
    where: { is_published: true },
    include: WITH_SUBCATEGORIES,
    orderBy: ORDER,
  });
  const meta = { page: 1, limit: data.length, total: data.length, totalPage: 1 };
  return { meta, data };
};

/** One category by id or slug (the admin's update page uses the slug). */
const getOne = async (idOrSlug: string) => {
  const result = await prisma.category.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: WITH_SUBCATEGORIES,
  });
  if (!result) throw notFound("Category");
  return result;
};

// ---------------------------------------------------------------- write

const create = async (body: Record<string, unknown>): Promise<Category> => {
  const data = pick(body, FIELDS) as Prisma.CategoryCreateInput;
  const slug = await makeSlug(data.name_en);
  const result = await prisma.category.create({ data: { ...data, slug } });
  return result;
};

const update = async (id: string, body: Record<string, unknown>): Promise<Category> => {
  const current = await prisma.category.findUnique({ where: { id } });
  if (!current) throw notFound("Category");
  const data = pick(body, FIELDS) as Prisma.CategoryUpdateInput;

  // Renamed → new slug.
  if (data.name_en && data.name_en !== current.name_en) {
    data.slug = await makeSlug(String(data.name_en), id);
  }

  const result = await prisma.category.update({ where: { id }, data });
  return result;
};

/** Only empty categories (no products, no sub-categories) can be deleted. */
const remove = async (id: string): Promise<Category> => {
  const productCount = await prisma.product.count({ where: { category_id: id, is_deleted: false } });
  if (productCount) {
    throw badRequest(`This category has ${productCount} product(s). Move or delete them first.`);
  }

  const subcategoryCount = await prisma.subCategory.count({ where: { category_id: id } });
  if (subcategoryCount) {
    throw badRequest(`This category has ${subcategoryCount} sub-categories. Delete them first.`);
  }

  const result = await prisma.category.delete({ where: { id } });
  return result;
};

export const CategoryService = { getAll, getPublished, getOne, create, update, remove };
