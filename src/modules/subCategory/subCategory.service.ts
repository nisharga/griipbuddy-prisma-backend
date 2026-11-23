import type { Prisma, SubCategory } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { notId } from "@/helpers/queryHelper";
import { NEWEST_FIRST, paginate, sortBy } from "@/helpers/queryBuilder";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

/**
 * Sub-categories, two levels in one table:
 *   sub-category      → `subcategory_id` is null           (e.g. Footwear › Sneakers)
 *   sub-sub-category  → `subcategory_id` is its parent's id (e.g. Sneakers › Running)
 */

// Only these fields can be set from the request body.
const FIELDS = [
  "name_en",
  "name_bn",
  "description_en",
  "description_bn",
  "image_url",
  "media",
  "position",
] as const;

/** Display order: by `position`, then oldest first. */
const ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }];

/** The parent category's basic fields. */
const CATEGORY = { select: { id: true, name_en: true, name_bn: true, slug: true } };

/** Include the sub-sub-categories (children). */
const WITH_CHILDREN = { sub_subcategories: { orderBy: ORDER } };

/** A URL slug from the name that no other sub-category uses. */
const makeSlug = (name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) => prisma.subCategory.count({ where: { slug, ...notId(exceptId) } }));

/** Throws 400 if the category doesn't exist. */
const assertCategoryExists = async (categoryId: string): Promise<void> => {
  const found = await prisma.category.count({ where: { id: categoryId } });
  if (!found) throw badRequest("Category not found.");
};

// ---------------------------------------------------------------- read

/** All sub-categories (not children), newest first, with category and children. Sort: name_en, position, createdAt. */
const getAll = async (pagination: IPagination) => {
  const where = { subcategory_id: null };
  const orderBy = sortBy(pagination, ["name_en", "position", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) =>
      prisma.subCategory.findMany({
        where,
        include: { category: CATEGORY, ...WITH_CHILDREN },
        orderBy,
        ...page,
      }),
    count: () => prisma.subCategory.count({ where }),
  });
  return { meta: result.meta, subcategories: result.data };
};

/** Sub-categories of one category (by category id). */
const getByCategoryId = async (categoryId: string): Promise<SubCategory[]> => {
  const result = await prisma.subCategory.findMany({
    where: { category_id: categoryId, subcategory_id: null },
    orderBy: ORDER,
  });
  return result;
};

/** Sub-categories (with children) of one category, by the category's slug. */
const getByCategorySlug = async (slug: string) => {
  const category = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (!category) throw notFound("Category");

  const result = await prisma.subCategory.findMany({
    where: { category_id: category.id, subcategory_id: null },
    include: WITH_CHILDREN,
    orderBy: ORDER,
  });
  return result;
};

/** One sub-category with its children, by id. */
const getChildrenById = async (id: string) => {
  const result = await prisma.subCategory.findUnique({ where: { id }, include: WITH_CHILDREN });
  if (!result) throw notFound("Sub-category");
  return result;
};

/**
 * Storefront collection header, by slug. Special collections like "best-selling"
 * aren't sub-categories, so for an unknown slug this returns an empty result (not 404).
 */
const getChildrenBySlug = async (slug: string) => {
  const subcategory = await prisma.subCategory.findUnique({ where: { slug }, include: WITH_CHILDREN });
  if (!subcategory) return { subSubCategories: null, sub_subcategories: [] };

  return {
    ...subcategory,
    subSubCategories: { id: subcategory.id, name_en: subcategory.name_en, slug: subcategory.slug },
  };
};

/** One sub-category by id or slug, with its category and children. */
const getOne = async (idOrSlug: string) => {
  const result = await prisma.subCategory.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { category: CATEGORY, ...WITH_CHILDREN },
  });
  if (!result) throw notFound("Sub-category");
  return result;
};

// ---------------------------------------------------------------- write

/** A sub-category under a category (`body.category` = category id). */
const create = async (body: Record<string, unknown>): Promise<SubCategory> => {
  const categoryId = String(body.category);
  await assertCategoryExists(categoryId);

  const data = pick(body, FIELDS) as Prisma.SubCategoryUncheckedCreateInput;
  const slug = await makeSlug(data.name_en);
  const result = await prisma.subCategory.create({ data: { ...data, category_id: categoryId, slug } });
  return result;
};

/** A sub-sub-category under a sub-category (`body.subcategory` = parent id). */
const createChild = async (body: Record<string, unknown>): Promise<SubCategory> => {
  const parent = await prisma.subCategory.findUnique({ where: { id: String(body.subcategory) } });
  if (!parent) throw badRequest("Parent sub-category not found.");
  if (parent.subcategory_id) throw badRequest("Only two levels of sub-categories are supported.");

  const data = pick(body, FIELDS) as Prisma.SubCategoryUncheckedCreateInput;
  const slug = await makeSlug(data.name_en);
  const result = await prisma.subCategory.create({
    data: { ...data, category_id: parent.category_id, subcategory_id: parent.id, slug },
  });
  return result;
};

/** Update; moving it to another category moves its children too. */
const update = async (id: string, body: Record<string, unknown>): Promise<SubCategory> => {
  const current = await prisma.subCategory.findUnique({ where: { id } });
  if (!current) throw notFound("Sub-category");

  const newCategoryId = body.category as string | undefined;
  if (newCategoryId) await assertCategoryExists(newCategoryId);

  const data = pick(body, FIELDS) as Prisma.SubCategoryUncheckedUpdateInput;
  if (newCategoryId) data.category_id = newCategoryId;

  // Renamed → new slug.
  if (data.name_en && data.name_en !== current.name_en) {
    data.slug = await makeSlug(String(data.name_en), id);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.subCategory.update({ where: { id }, data });
    // Children always live under their parent's category.
    if (newCategoryId) {
      await tx.subCategory.updateMany({
        where: { subcategory_id: id },
        data: { category_id: newCategoryId },
      });
    }
    return updated;
  });
  return result;
};

/** Only sub-categories with no products and no children can be deleted. */
const remove = async (id: string): Promise<SubCategory> => {
  const productCount = await prisma.product.count({
    where: { OR: [{ subcategory_id: id }, { sub_subcategory_id: id }], is_deleted: false },
  });
  if (productCount) throw badRequest(`${productCount} product(s) use this sub-category. Move them first.`);

  const childCount = await prisma.subCategory.count({ where: { subcategory_id: id } });
  if (childCount) {
    throw badRequest(`This sub-category has ${childCount} sub-sub-categories. Delete them first.`);
  }

  const result = await prisma.subCategory.delete({ where: { id } });
  return result;
};

/** Only sub-sub-categories that no product uses can be deleted. */
const removeChild = async (id: string): Promise<void> => {
  const productCount = await prisma.product.count({ where: { sub_subcategory_id: id, is_deleted: false } });
  if (productCount) {
    throw badRequest(`${productCount} product(s) use this sub-sub-category. Move them first.`);
  }

  // `subcategory_id: not null` makes sure this only deletes a child, never a top-level sub-category.
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
