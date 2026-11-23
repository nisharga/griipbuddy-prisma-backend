import type { Prisma, ReturnPolicy } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { notId } from "@/helpers/queryHelper";
import { NEWEST_FIRST, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

/** Return policies: admin CRUD + the active list for the product form. */

// Only these fields can be set from the request body.
const FIELDS = ["title", "description", "return_period_days", "conditions", "is_active"] as const;

/** A URL slug from the title that no other policy uses. */
const makeSlug = (title: string, exceptId?: string) =>
  uniqueSlug(title, (slug) => prisma.returnPolicy.count({ where: { slug, ...notId(exceptId) } }));

// ---------------------------------------------------------------- read

/** Active policies, shortest return period first (product form). */
const getActive = async () => {
  const data = await prisma.returnPolicy.findMany({
    where: { is_active: true },
    orderBy: { return_period_days: "asc" },
  });
  return { data };
};

/** All policies, newest first. Search: title. Sort: title, return_period_days, createdAt. */
const getAll = async (pagination: IPagination, search?: string) => {
  const where = searchWhere<Prisma.ReturnPolicyWhereInput>(search, ["title"]);
  const orderBy = sortBy(pagination, ["title", "return_period_days", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.returnPolicy.findMany({ where, orderBy, ...page }),
    count: () => prisma.returnPolicy.count({ where }),
  });
  return result;
};

/** One policy by id. */
const getById = async (id: string): Promise<ReturnPolicy> => {
  const result = await prisma.returnPolicy.findUnique({ where: { id } });
  if (!result) throw notFound("Return policy");
  return result;
};

// ---------------------------------------------------------------- write

const create = async (body: Record<string, unknown>): Promise<ReturnPolicy> => {
  const data = pick(body, FIELDS) as Prisma.ReturnPolicyCreateInput;
  const slug = await makeSlug(data.title);
  const result = await prisma.returnPolicy.create({ data: { ...data, slug } });
  return result;
};

/** Active ↔ inactive. */
const toggleStatus = async (id: string): Promise<ReturnPolicy> => {
  const policy = await getById(id);
  const result = await prisma.returnPolicy.update({ where: { id }, data: { is_active: !policy.is_active } });
  return result;
};

const update = async (id: string, body: Record<string, unknown>): Promise<ReturnPolicy> => {
  const current = await getById(id);
  const data = pick(body, FIELDS) as Prisma.ReturnPolicyUpdateInput;

  // Renamed → new slug.
  if (data.title && data.title !== current.title) data.slug = await makeSlug(String(data.title), id);

  const result = await prisma.returnPolicy.update({ where: { id }, data });
  return result;
};

/** Only policies that no product uses can be deleted. */
const remove = async (id: string): Promise<ReturnPolicy> => {
  const usedBy = await prisma.product.count({ where: { return_policy_id: id, is_deleted: false } });
  if (usedBy) {
    throw badRequest(`${usedBy} product(s) use this return policy. Change it on those products first.`);
  }

  const result = await prisma.returnPolicy.delete({ where: { id } });
  return result;
};

export const ReturnPolicyService = { getActive, getAll, getById, create, toggleStatus, update, remove };
