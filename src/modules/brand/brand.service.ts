import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

const FIELDS = ["name", "tags", "is_active"] as const;
const slugFor = (text: string, exceptId?: string) =>
  uniqueSlug(text, (slug) =>
    prisma.brand.count({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  );

/** Active brands for dropdowns. */
const getActive = () => prisma.brand.findMany({ where: { is_active: true }, orderBy: { name: "asc" } });

const getAll = async (p: IPagination, term?: string) => {
  const where: Prisma.BrandWhereInput = term
    ? { OR: [{ name: contains(term) }, { tags: { has: term } }] }
    : {};
  const [brands, total] = await prisma.$transaction([
    prisma.brand.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.limit }),
    prisma.brand.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), brands };
};

const getById = async (id: string) => {
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) throw notFound("Brand");
  return brand;
};

const create = async (body: Record<string, unknown>) => {
  const data = pick(body, FIELDS) as Prisma.BrandCreateInput;
  return prisma.brand.create({ data: { ...data, slug: await slugFor(data.name) } });
};

const update = async (id: string, body: Record<string, unknown>) => {
  const current = await getById(id);
  const data = pick(body, FIELDS) as Prisma.BrandUpdateInput;
  if (data.name && data.name !== current.name) data.slug = await slugFor(String(data.name), id);
  return prisma.brand.update({ where: { id }, data });
};

const remove = async (id: string) => {
  const used = await prisma.product.count({ where: { brand_id: id, is_deleted: false } });
  if (used) throw badRequest(`${used} product(s) use this brand. Change their brand first.`);
  return prisma.brand.delete({ where: { id } });
};

export const BrandService = { getActive, getAll, getById, create, update, remove };
