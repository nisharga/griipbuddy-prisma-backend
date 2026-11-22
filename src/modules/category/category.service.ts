import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

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
const ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }];

/** Direct sub-categories with their own children (2 levels). */
const withSubcategories = {
  subcategories: {
    where: { subcategory_id: null },
    orderBy: ORDER,
    include: { sub_subcategories: { orderBy: ORDER } },
  },
};

const slugFor = (name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) =>
    prisma.category.count({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  );

/** Shoppers only see published categories; staff see all. */
const getAll = async (p: IPagination, includeUnpublished: boolean) => {
  const where: Prisma.CategoryWhereInput = includeUnpublished ? {} : { is_published: true };
  const [data, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      include: withSubcategories,
      orderBy: ORDER,
      skip: p.skip,
      take: p.limit,
    }),
    prisma.category.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), data };
};

/** Storefront navbar / home: every published category with its sub-categories (no paging). */
const getPublished = async () => {
  const data = await prisma.category.findMany({
    where: { is_published: true },
    include: withSubcategories,
    orderBy: ORDER,
  });
  return { meta: { page: 1, limit: data.length, total: data.length, totalPage: 1 }, data };
};

/** By id or slug (the admin's update page is /update-category/[slug]). */
const getOne = async (idOrSlug: string) => {
  const category = await prisma.category.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: withSubcategories,
  });
  if (!category) throw notFound("Category");
  return category;
};

const create = async (body: Record<string, unknown>) => {
  const data = pick(body, FIELDS) as Prisma.CategoryCreateInput;
  return prisma.category.create({ data: { ...data, slug: await slugFor(data.name_en) } });
};

const update = async (id: string, body: Record<string, unknown>) => {
  const current = await prisma.category.findUnique({ where: { id } });
  if (!current) throw notFound("Category");
  const data = pick(body, FIELDS) as Prisma.CategoryUpdateInput;
  if (data.name_en && data.name_en !== current.name_en) data.slug = await slugFor(String(data.name_en), id);
  return prisma.category.update({ where: { id }, data });
};

const remove = async (id: string) => {
  const [subs, products] = await Promise.all([
    prisma.subCategory.count({ where: { category_id: id } }),
    prisma.product.count({ where: { category_id: id, is_deleted: false } }),
  ]);
  if (products) throw badRequest(`This category has ${products} product(s). Move or delete them first.`);
  if (subs) throw badRequest(`This category has ${subs} sub-categories. Delete them first.`);
  return prisma.category.delete({ where: { id } });
};

export const CategoryService = { getAll, getPublished, getOne, create, update, remove };
