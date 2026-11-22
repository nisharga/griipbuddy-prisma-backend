import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";

const FIELDS = ["title", "description", "return_period_days", "conditions", "is_active"] as const;
const slugFor = (text: string, exceptId?: string) =>
  uniqueSlug(text, (slug) =>
    prisma.returnPolicy.count({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  );

/** Active policies for the product form. */
const getActive = async () => ({
  data: await prisma.returnPolicy.findMany({
    where: { is_active: true },
    orderBy: { return_period_days: "asc" },
  }),
});

const getAll = async (p: IPagination, search?: string) => {
  const where: Prisma.ReturnPolicyWhereInput = search ? { title: contains(search) } : {};
  const [data, total] = await prisma.$transaction([
    prisma.returnPolicy.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.limit }),
    prisma.returnPolicy.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), data };
};

const getById = async (id: string) => {
  const policy = await prisma.returnPolicy.findUnique({ where: { id } });
  if (!policy) throw notFound("Return policy");
  return policy;
};

const create = async (body: Record<string, unknown>) => {
  const data = pick(body, FIELDS) as Prisma.ReturnPolicyCreateInput;
  return prisma.returnPolicy.create({ data: { ...data, slug: await slugFor(data.title) } });
};

const toggleStatus = async (id: string) => {
  const policy = await getById(id);
  return prisma.returnPolicy.update({ where: { id }, data: { is_active: !policy.is_active } });
};

const update = async (id: string, body: Record<string, unknown>) => {
  const current = await getById(id);
  const data = pick(body, FIELDS) as Prisma.ReturnPolicyUpdateInput;
  if (data.title && data.title !== current.title) data.slug = await slugFor(String(data.title), id);
  return prisma.returnPolicy.update({ where: { id }, data });
};

const remove = async (id: string) => {
  const used = await prisma.product.count({ where: { return_policy_id: id, is_deleted: false } });
  if (used) throw badRequest(`${used} product(s) use this return policy. Change it on those products first.`);
  return prisma.returnPolicy.delete({ where: { id } });
};

export const ReturnPolicyService = { getActive, getAll, getById, create, toggleStatus, update, remove };
