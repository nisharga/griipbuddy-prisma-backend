import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";

const FIELDS = [
  "name",
  "contact_id",
  "address",
  "email",
  "phone",
  "default_payment_terms",
  "tax_info",
  "notes",
  "type",
] as const;

const getAll = async (p: IPagination, search?: string) => {
  const where: Prisma.SupplierWhereInput = search
    ? { OR: [{ name: contains(search) }, { phone: contains(search) }, { contact_id: contains(search) }] }
    : {};
  const [data, total] = await prisma.$transaction([
    prisma.supplier.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.limit }),
    prisma.supplier.count({ where }),
  ]);
  return { data, meta: paginationHelpers.buildMeta(p, total) };
};

const getById = async (id: string) => {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw notFound("Supplier");
  return supplier;
};

const create = (body: Record<string, unknown>) =>
  prisma.supplier.create({ data: pick(body, FIELDS) as Prisma.SupplierCreateInput });

const update = (id: string, body: Record<string, unknown>) =>
  prisma.supplier.update({ where: { id }, data: pick(body, FIELDS) as Prisma.SupplierUpdateInput });

const remove = (id: string) => prisma.supplier.delete({ where: { id } });

export const SupplierService = { getAll, getById, create, update, remove };
