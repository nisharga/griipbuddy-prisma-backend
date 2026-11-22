import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";
import { StockService } from "@/app/modules/stock/stock.service";

const FIELDS = ["name", "type", "address", "location", "manager_name", "contact_numbers"] as const;

const slugFor = (name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) =>
    prisma.businessLocation.count({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  );

const getAll = async (p: IPagination, f: { type?: string; search?: string }) => {
  const type = f.type?.toUpperCase();
  const where: Prisma.BusinessLocationWhereInput = {
    ...(type === "OUTLET" || type === "WAREHOUSE" ? { type } : {}),
    ...(f.search ? { name: contains(f.search) } : {}),
  };
  const [businessLocations, total] = await prisma.$transaction([
    prisma.businessLocation.findMany({
      where,
      orderBy: [{ type: "asc" }, { name: "asc" }],
      skip: p.skip,
      take: p.limit,
    }),
    prisma.businessLocation.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), businessLocations };
};

const getById = async (id: string) => {
  const location = await prisma.businessLocation.findUnique({ where: { id } });
  if (!location) throw notFound("Business location");
  return location;
};

const create = async (body: Record<string, unknown>) => {
  const data = pick(body, FIELDS) as Prisma.BusinessLocationUncheckedCreateInput;
  return prisma.$transaction(async (tx) => {
    const created = await tx.businessLocation.create({ data: { ...data, slug: await slugFor(data.name) } });
    await StockService.ensureStockRows(tx, { locationIds: [created.id] }); // every product can be stocked here
    return created;
  });
};

const update = async (id: string, body: Record<string, unknown>) => {
  const current = await getById(id);
  const data = pick(body, FIELDS) as Prisma.BusinessLocationUncheckedUpdateInput;
  if (data.name && data.name !== current.name) data.slug = await slugFor(String(data.name), id);
  return prisma.businessLocation.update({ where: { id }, data });
};

const remove = async (id: string) => {
  const [staffCount, stocked] = await Promise.all([
    prisma.user.count({ where: { outlet_id: id, is_deleted: false } }),
    prisma.stock.count({
      where: {
        business_location_id: id,
        OR: [{ available_quantity: { gt: 0 } }, { reserved_quantity: { gt: 0 } }],
      },
    }),
  ]);
  if (staffCount)
    throw badRequest(`${staffCount} staff member(s) are assigned to this location. Reassign them first.`);
  if (stocked) throw badRequest("This location still holds stock. Move or adjust it to 0 first.");
  await getById(id);
  await prisma.$transaction([
    prisma.stock.deleteMany({ where: { business_location_id: id } }),
    prisma.businessLocation.delete({ where: { id } }),
  ]);
};

export const BusinessLocationService = { getAll, getById, create, update, remove };
