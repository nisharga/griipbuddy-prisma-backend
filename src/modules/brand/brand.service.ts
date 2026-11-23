import type { Brand, Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { contains, notId } from "@/helpers/queryHelper";
import { NEWEST_FIRST, paginate, sortBy } from "@/helpers/queryBuilder";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

/** Brands: admin CRUD + active brands for the product form's dropdown. */

// Only these fields can be set from the request body.
const FIELDS = ["name", "tags", "is_active"] as const;

/** A URL slug from the name that no other brand uses. */
const makeSlug = (name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) => prisma.brand.count({ where: { slug, ...notId(exceptId) } }));

// ---------------------------------------------------------------- read

/** Active brands, A → Z (product form dropdown). */
const getActive = async (): Promise<Brand[]> => {
  const result = await prisma.brand.findMany({ where: { is_active: true }, orderBy: { name: "asc" } });
  return result;
};

/** All brands, newest first. Search: name or exact tag. Sort: name, createdAt. */
const getAll = async (pagination: IPagination, search?: string) => {
  const where: Prisma.BrandWhereInput = {};
  if (search) where.OR = [{ name: contains(search) }, { tags: { has: search } }];
  const orderBy = sortBy(pagination, ["name", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.brand.findMany({ where, orderBy, ...page }),
    count: () => prisma.brand.count({ where }),
  });
  return { meta: result.meta, brands: result.data };
};

/** One brand by id. */
const getById = async (id: string): Promise<Brand> => {
  const result = await prisma.brand.findUnique({ where: { id } });
  if (!result) throw notFound("Brand");
  return result;
};

// ---------------------------------------------------------------- write

const create = async (body: Record<string, unknown>): Promise<Brand> => {
  const data = pick(body, FIELDS) as Prisma.BrandCreateInput;
  const slug = await makeSlug(data.name);
  const result = await prisma.brand.create({ data: { ...data, slug } });
  return result;
};

const update = async (id: string, body: Record<string, unknown>): Promise<Brand> => {
  const current = await getById(id);
  const data = pick(body, FIELDS) as Prisma.BrandUpdateInput;

  // Renamed → new slug.
  if (data.name && data.name !== current.name) data.slug = await makeSlug(String(data.name), id);

  const result = await prisma.brand.update({ where: { id }, data });
  return result;
};

/** Only brands that no product uses can be deleted. */
const remove = async (id: string): Promise<Brand> => {
  const usedBy = await prisma.product.count({ where: { brand_id: id, is_deleted: false } });
  if (usedBy) throw badRequest(`${usedBy} product(s) use this brand. Change their brand first.`);

  const result = await prisma.brand.delete({ where: { id } });
  return result;
};

export const BrandService = { getActive, getAll, getById, create, update, remove };
