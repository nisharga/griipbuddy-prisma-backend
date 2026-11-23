import type { BusinessLocation, Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import pick from "@/shared/pick";
import { badRequest, notFound } from "@/errors/ApiError";
import { notId } from "@/helpers/queryHelper";
import { paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import { uniqueSlug } from "@/helpers/slugHelper";
import type { IPagination } from "@/interfaces/pagination";
import { StockService } from "@/modules/stock/stock.service";

/** Business locations: outlets (shops) and warehouses that hold stock. */

// Only these fields can be set from the request body.
const FIELDS = ["name", "type", "address", "location", "manager_name", "contact_numbers"] as const;

/** A URL slug from the name that no other location uses. */
const makeSlug = (name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) => prisma.businessLocation.count({ where: { slug, ...notId(exceptId) } }));

// ---------------------------------------------------------------- read

/** All locations, outlets first then A → Z. Filter: type. Search: name. Sort: name, type, createdAt. */
const getAll = async (pagination: IPagination, filters: { type?: string; search?: string }) => {
  const where = searchWhere<Prisma.BusinessLocationWhereInput>(filters.search, ["name"]);
  const type = filters.type?.toUpperCase();
  if (type === "OUTLET" || type === "WAREHOUSE") where.type = type;

  const defaultOrder: Prisma.BusinessLocationOrderByWithRelationInput[] = [{ type: "asc" }, { name: "asc" }];
  const orderBy = sortBy(pagination, ["name", "type", "createdAt"], defaultOrder);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.businessLocation.findMany({ where, orderBy, ...page }),
    count: () => prisma.businessLocation.count({ where }),
  });
  return { meta: result.meta, businessLocations: result.data };
};

/** One location by id. */
const getById = async (id: string): Promise<BusinessLocation> => {
  const result = await prisma.businessLocation.findUnique({ where: { id } });
  if (!result) throw notFound("Business location");
  return result;
};

// ---------------------------------------------------------------- write

/** Creates the location and an empty stock row for every product variant there. */
const create = async (body: Record<string, unknown>): Promise<BusinessLocation> => {
  const data = pick(body, FIELDS) as Prisma.BusinessLocationUncheckedCreateInput;
  const slug = await makeSlug(data.name);

  const result = await prisma.$transaction(async (tx) => {
    const location = await tx.businessLocation.create({ data: { ...data, slug } });
    await StockService.ensureStockRows(tx, { locationIds: [location.id] });
    return location;
  });
  return result;
};

const update = async (id: string, body: Record<string, unknown>): Promise<BusinessLocation> => {
  const current = await getById(id);
  const data = pick(body, FIELDS) as Prisma.BusinessLocationUncheckedUpdateInput;

  // Renamed → new slug.
  if (data.name && data.name !== current.name) data.slug = await makeSlug(String(data.name), id);

  const result = await prisma.businessLocation.update({ where: { id }, data });
  return result;
};

/** Only locations with no staff and no stock can be deleted. */
const remove = async (id: string): Promise<void> => {
  const staffCount = await prisma.user.count({ where: { outlet_id: id, is_deleted: false } });
  if (staffCount) {
    throw badRequest(`${staffCount} staff member(s) are assigned to this location. Reassign them first.`);
  }

  const stockedRows = await prisma.stock.count({
    where: {
      business_location_id: id,
      OR: [{ available_quantity: { gt: 0 } }, { reserved_quantity: { gt: 0 } }],
    },
  });
  if (stockedRows) throw badRequest("This location still holds stock. Move or adjust it to 0 first.");

  await getById(id); // 404 if it doesn't exist

  // Its (empty) stock rows go with it.
  await prisma.$transaction([
    prisma.stock.deleteMany({ where: { business_location_id: id } }),
    prisma.businessLocation.delete({ where: { id } }),
  ]);
};

export const BusinessLocationService = { getAll, getById, create, update, remove };
