import type { Prisma, Supplier } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { notFound } from "@/errors/ApiError";
import { NEWEST_FIRST, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";

/** Suppliers: the companies/people stock is bought from (used by purchases). */

// Only these fields can be set from the request body.
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

// ---------------------------------------------------------------- read

/** All suppliers, newest first. Search: name, phone, contact id. Sort: name, contact_id, createdAt. */
const getAll = async (pagination: IPagination, search?: string) => {
  const where = searchWhere<Prisma.SupplierWhereInput>(search, ["name", "phone", "contact_id"]);
  const orderBy = sortBy(pagination, ["name", "contact_id", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.supplier.findMany({ where, orderBy, ...page }),
    count: () => prisma.supplier.count({ where }),
  });
  return result;
};

/** One supplier by id. */
const getById = async (id: string): Promise<Supplier> => {
  const result = await prisma.supplier.findUnique({ where: { id } });
  if (!result) throw notFound("Supplier");
  return result;
};

// ---------------------------------------------------------------- write

const create = async (body: Record<string, unknown>): Promise<Supplier> => {
  const data = pick(body, FIELDS) as Prisma.SupplierCreateInput;
  const result = await prisma.supplier.create({ data });
  return result;
};

const update = async (id: string, body: Record<string, unknown>): Promise<Supplier> => {
  const data = pick(body, FIELDS) as Prisma.SupplierUpdateInput;
  const result = await prisma.supplier.update({ where: { id }, data });
  return result;
};

const remove = async (id: string): Promise<Supplier> => {
  const result = await prisma.supplier.delete({ where: { id } });
  return result;
};

export const SupplierService = { getAll, getById, create, update, remove };
