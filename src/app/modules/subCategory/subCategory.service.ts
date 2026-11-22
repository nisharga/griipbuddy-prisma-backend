import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

/**
 * One table, two levels: sub-categories (`subcategory_id = null`) and
 * sub-sub-categories (`subcategory_id` = parent).
 */
const FIELDS = [
  "name_en",
  "name_bn",
  "description_en",
  "description_bn",
  "image_url",
  "media",
  "position",
] as const;
const ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }];
const CATEGORY = { select: { id: true, name_en: true, name_bn: true, slug: true } };
const CHILDREN = { sub_subcategories: { orderBy: ORDER } };

const slugFor = (text: string, exceptId?: string) =>
  uniqueSlug(text, (slug) =>
    prisma.subCategory.count({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  );

const getAll = async (p: IPagination) => {
  const where = { subcategory_id: null };
  const [subcategories, total] = await prisma.$transaction([
    prisma.subCategory.findMany({
      where,
      include: { category: CATEGORY, ...CHILDREN },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.subCategory.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), subcategories };
};

const getByCategoryId = (categoryId: string) =>
  prisma.subCategory.findMany({ where: { category_id: categoryId, subcategory_id: null }, orderBy: ORDER });

const getByCategorySlug = async (slug: string) => {
  const category = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (!category) throw notFound("Category");
  return prisma.subCategory.findMany({
    where: { category_id: category.id, subcategory_id: null },
    include: CHILDREN,
    orderBy: ORDER,
  });
};

const getChildrenById = async (id: string) => {
  const parent = await prisma.subCategory.findUnique({ where: { id }, include: CHILDREN });
  if (!parent) throw notFound("Sub-category");
  return parent;
};

/** Storefront collection header. Special collection slugs ("best-selling") have no document. */
const getChildrenBySlug = async (slug: string) => {
  const doc = await prisma.subCategory.findUnique({ where: { slug }, include: CHILDREN });
  return doc
    ? { ...doc, subSubCategories: { id: doc.id, name_en: doc.name_en, slug: doc.slug } }
    : { subSubCategories: null, sub_subcategories: [] };
};

const getOne = async (idOrSlug: string) => {
  const doc = await prisma.subCategory.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { category: CATEGORY, ...CHILDREN },
  });
  if (!doc) throw notFound("Sub-category");
  return doc;
};

const create = async (body: Record<string, unknown>) => {
  const categoryId = String(body.category);
  if (!(await prisma.category.count({ where: { id: categoryId } }))) throw badRequest("Category not found.");
  const data = pick(body, FIELDS) as Prisma.SubCategoryUncheckedCreateInput;
  return prisma.subCategory.create({
    data: { ...data, category_id: categoryId, slug: await slugFor(data.name_en) },
  });
};

const createChild = async (body: Record<string, unknown>) => {
  const parent = await prisma.subCategory.findUnique({ where: { id: String(body.subcategory) } });
  if (!parent) throw badRequest("Parent sub-category not found.");
  if (parent.subcategory_id) throw badRequest("Only two levels of sub-categories are supported.");
  const data = pick(body, FIELDS) as Prisma.SubCategoryUncheckedCreateInput;
  return prisma.subCategory.create({
    data: {
      ...data,
      category_id: parent.category_id,
      subcategory_id: parent.id,
      slug: await slugFor(data.name_en),
    },
  });
};

const update = async (id: string, body: Record<string, unknown>) => {
  const current = await prisma.subCategory.findUnique({ where: { id } });
  if (!current) throw notFound("Sub-category");
  const data = pick(body, FIELDS) as Prisma.SubCategoryUncheckedUpdateInput;
  const categoryId = body.category as string | undefined;
  if (categoryId && !(await prisma.category.count({ where: { id: categoryId } })))
    throw badRequest("Category not found.");
  if (data.name_en && data.name_en !== current.name_en) data.slug = await slugFor(String(data.name_en), id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.subCategory.update({
      where: { id },
      data: { ...data, ...(categoryId ? { category_id: categoryId } : {}) },
    });
    // Children always live under their parent's category.
    if (categoryId)
      await tx.subCategory.updateMany({ where: { subcategory_id: id }, data: { category_id: categoryId } });
    return updated;
  });
};

const remove = async (id: string) => {
  const [children, products] = await Promise.all([
    prisma.subCategory.count({ where: { subcategory_id: id } }),
    prisma.product.count({
      where: { OR: [{ subcategory_id: id }, { sub_subcategory_id: id }], is_deleted: false },
    }),
  ]);
  if (products) throw badRequest(`${products} product(s) use this sub-category. Move them first.`);
  if (children) throw badRequest(`This sub-category has ${children} sub-sub-categories. Delete them first.`);
  return prisma.subCategory.delete({ where: { id } });
};

const removeChild = async (id: string) => {
  const used = await prisma.product.count({ where: { sub_subcategory_id: id, is_deleted: false } });
  if (used) throw badRequest(`${used} product(s) use this sub-sub-category. Move them first.`);
  const { count } = await prisma.subCategory.deleteMany({ where: { id, subcategory_id: { not: null } } });
  if (!count) throw notFound("Sub-sub-category");
};

export const SubCategoryService = {
  getAll,
  getByCategoryId,
  getByCategorySlug,
  getChildrenById,
  getChildrenBySlug,
  getOne,
  create,
  createChild,
  update,
  remove,
  removeChild,
};
