import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { dateRange, numberRange } from "@/helpers/queryHelper";
import { filterWhere, NEWEST_FIRST, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";

/**
 * Stock: one row per product variant × business location.
 *   available_quantity — can be sold now
 *   reserved_quantity  — held for placed orders that haven't shipped yet
 *
 * The functions that move stock take a Prisma client OR a transaction (`db`), so
 * callers can combine several moves with other writes in one `$transaction`.
 * Every decrease only runs if enough is left (`WHERE available >= n`), and the
 * database also has CHECK (>= 0) rules, so stock can never go negative.
 *
 * The Check Outlet Stocks report lives in ./stock.report.service.ts.
 */

/** Which stock row an order took units from, and how many. */
export type Allocation = { stock_id: string; variant_id: string; quantity: number };

/** Order statuses whose units count as sold (product `total_sold`, reports, reviews). */
export const SOLD_STATUSES: OrderStatus[] = ["DELIVERED", "RETURN_REQUESTED", "PENDING_RETURN"];

/** The location fields shown with a stock row. */
const LOCATION = { select: { id: true, name: true, type: true } } as const;

// ---------------------------------------------------------------- stock rows

/**
 * Make sure every variant × location pair has a stock row (quantity 0).
 * Safe to call again — existing rows are left alone.
 */
const ensureStockRows = async (db: Db, scope: { variantIds?: string[]; locationIds?: string[] } = {}) => {
  const variants = await db.productVariant.findMany({
    where: scope.variantIds ? { id: { in: scope.variantIds } } : {},
    select: { id: true, product_id: true },
  });
  const locations = await db.businessLocation.findMany({
    where: scope.locationIds ? { id: { in: scope.locationIds } } : {},
    select: { id: true },
  });

  const rows = [];
  for (const variant of variants) {
    for (const location of locations) {
      rows.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        business_location_id: location.id,
      });
    }
  }
  if (rows.length) await db.stock.createMany({ data: rows, skipDuplicates: true });
};

// ---------------------------------------------------------------- order stock moves

/**
 * Reserve units for order lines. Takes from the best-stocked location first and
 * splits across locations when needed. Throws 409 if something is short — run it
 * inside a transaction so a failure also undoes the lines already reserved.
 */
const reserve = async (db: Db, lines: { variant_id: string; quantity: number; label: string }[]) => {
  const taken: Allocation[] = [];

  for (const line of lines) {
    let stillNeeded = line.quantity;
    const rows = await db.stock.findMany({
      where: { variant_id: line.variant_id, available_quantity: { gt: 0 } },
      orderBy: { available_quantity: "desc" },
    });

    for (const row of rows) {
      if (stillNeeded <= 0) break;

      let quantity = Math.min(stillNeeded, row.available_quantity);
      while (quantity > 0) {
        // Only reserve if the units are still there (another order may have just taken some).
        const { count } = await db.stock.updateMany({
          where: { id: row.id, available_quantity: { gte: quantity } },
          data: { available_quantity: { decrement: quantity }, reserved_quantity: { increment: quantity } },
        });
        if (count) {
          taken.push({ stock_id: row.id, variant_id: line.variant_id, quantity });
          stillNeeded -= quantity;
          break;
        }
        // Someone took units meanwhile: re-read what's left and try again.
        const fresh = await db.stock.findUnique({
          where: { id: row.id },
          select: { available_quantity: true },
        });
        quantity = Math.min(stillNeeded, fresh?.available_quantity ?? 0);
      }
    }

    if (stillNeeded > 0) {
      const got = line.quantity - stillNeeded;
      if (got > 0)
        throw conflict(`Only ${got} left in stock for "${line.label}". Please reduce the quantity.`);
      throw conflict(`"${line.label}" is out of stock.`);
    }
  }

  return taken;
};

/** Run the same stock update for every allocation. */
const updateEach = async (db: Db, allocations: Allocation[], change: (quantity: number) => object) => {
  for (const allocation of allocations) {
    await db.stock.update({ where: { id: allocation.stock_id }, data: change(allocation.quantity) });
  }
};

/** Reserved → available again (order cancelled before shipping). */
const release = (db: Db, allocations: Allocation[]) =>
  updateEach(db, allocations, (qty) => ({
    available_quantity: { increment: qty },
    reserved_quantity: { decrement: qty },
  }));

/** Reserved → gone (order shipped). */
const commit = (db: Db, allocations: Allocation[]) =>
  updateEach(db, allocations, (qty) => ({ reserved_quantity: { decrement: qty } }));

/** Shipped → back on the shelf (order returned). */
const restock = (db: Db, allocations: Allocation[]) =>
  updateEach(db, allocations, (qty) => ({ available_quantity: { increment: qty } }));

/** Shipped → reserved again (order moved back before shipping). */
const unship = (db: Db, allocations: Allocation[]) =>
  updateEach(db, allocations, (qty) => ({ reserved_quantity: { increment: qty } }));

// ---------------------------------------------------------------- manual adjustments

/** Add to / deduct from one stock row. Returns [old quantity, new quantity]. */
const adjust = async (db: Db, stockId: string, action: "ADDITION" | "DEDUCTION", quantity: number) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest("Quantity must be a whole number greater than 0.");
  }

  const row = await db.stock.findUnique({ where: { id: stockId } });
  if (!row) throw notFound("Stock record");

  if (action === "DEDUCTION") {
    // Only deduct if enough is left.
    const { count } = await db.stock.updateMany({
      where: { id: stockId, available_quantity: { gte: quantity } },
      data: { available_quantity: { decrement: quantity } },
    });
    if (!count) throw badRequest(`Cannot deduct ${quantity}: only ${row.available_quantity} available.`);
  } else {
    await db.stock.update({ where: { id: stockId }, data: { available_quantity: { increment: quantity } } });
  }

  const after = await db.stock.findUniqueOrThrow({
    where: { id: stockId },
    select: { available_quantity: true },
  });
  const newQuantity = after.available_quantity;
  const oldQuantity = action === "DEDUCTION" ? newQuantity + quantity : newQuantity - quantity;
  return [oldQuantity, newQuantity] as const;
};

type AdjustmentInput = {
  business_location: string;
  action: "ADDITION" | "DEDUCTION";
  note?: string;
  products: { stock: string; quantity: number; product_note?: string; selected_variant?: unknown }[];
};

/** A stock adjustment with several lines, saved as one transaction (all or nothing). */
const createAdjustment = async (input: AdjustmentInput, actorId: string) => {
  const stockIds = input.products.map((line) => line.stock);
  if (new Set(stockIds).size !== stockIds.length)
    throw badRequest("The same product variant is listed twice.");

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.stock.findMany({ where: { id: { in: stockIds } } });
    if (rows.length !== stockIds.length) throw notFound("One or more stock records");

    const wrongLocation = rows.some((row) => row.business_location_id !== input.business_location);
    if (wrongLocation) throw badRequest("All products must belong to the selected business location.");

    const items = [];
    for (const line of input.products) {
      const row = rows.find((r) => r.id === line.stock)!;
      const [old_quantity, new_quantity] = await adjust(tx, row.id, input.action, line.quantity);
      items.push({
        stock_id: row.id,
        product_id: row.product_id,
        variant_id: row.variant_id,
        selected_variant: (line.selected_variant ?? undefined) as Prisma.InputJsonValue | undefined,
        quantity: line.quantity,
        old_quantity,
        new_quantity,
        product_note: line.product_note,
      });
    }

    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    return tx.stockAdjustment.create({
      data: {
        business_location_id: input.business_location,
        action: input.action,
        note: input.note,
        adjust_by_id: actorId,
        total_amount: totalUnits,
        products: { create: items },
      },
      include: { products: true },
    });
  });
  return result;
};

/** Adjustment history, newest first, each line with its product's name. */
const getAdjustments = async (
  pagination: IPagination,
  filters: {
    action?: string;
    locationId?: string;
    adjustBy?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }
) => {
  const action = filters.action === "ADDITION" || filters.action === "DEDUCTION" ? filters.action : undefined;
  const where = filterWhere<Prisma.StockAdjustmentWhereInput>({
    action,
    business_location_id: filters.locationId,
    adjust_by_id: filters.adjustBy,
    activities_date: dateRange(filters.startDate, filters.endDate),
  });

  // Search by product name → adjustments that contain one of those products.
  if (filters.search) {
    const products = await prisma.product.findMany({
      where: searchWhere<Prisma.ProductWhereInput>(filters.search, ["name"]),
      select: { id: true },
    });
    where.products = { some: { product_id: { in: products.map((product) => product.id) } } };
  }

  const orderBy = sortBy(pagination, ["createdAt", "activities_date"], NEWEST_FIRST);
  const result = await paginate(pagination, {
    findMany: (page) =>
      prisma.stockAdjustment.findMany({
        where,
        include: {
          business_location: LOCATION,
          adjust_by: { select: { id: true, full_name: true, role: true } },
          products: true,
        },
        orderBy,
        ...page,
      }),
    count: () => prisma.stockAdjustment.count({ where }),
  });

  // Put each line's product (name, sku, thumbnail) in place of its product id.
  const productIds = [...new Set(result.data.flatMap((adj) => adj.products.map((line) => line.product_id)))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true, thumbnail: true },
  });
  const data = result.data.map((adjustment) => ({
    ...adjustment,
    products: adjustment.products.map(({ product_id, ...line }) => ({
      ...line,
      product: products.find((product) => product.id === product_id) ?? product_id,
    })),
  }));

  return { data, meta: result.meta };
};

// ---------------------------------------------------------------- lists

/** Storefront: how many units of one variant each location has. */
const getAvailability = async (productId: string, variantId: string) => {
  const stocks = await prisma.stock.findMany({
    where: { product_id: productId, variant_id: variantId },
    include: { business_location: LOCATION },
  });
  const totalAvailableQuantity = stocks.reduce((sum, row) => sum + row.available_quantity, 0);
  return { totalAvailableQuantity, stocks };
};

/** Stock rows for the Stock Adjustment product search. Filter: location, quantity range. Search: product/variant name, SKU, barcode. */
const getStocks = async (
  pagination: IPagination,
  filters: { term?: string; locationId?: string; minQty?: number; maxQty?: number }
) => {
  const where: Prisma.StockWhereInput = {
    product: { is_deleted: false },
    ...filterWhere<Prisma.StockWhereInput>({
      business_location_id: filters.locationId,
      available_quantity: numberRange(filters.minQty, filters.maxQty),
    }),
    ...searchWhere<Prisma.StockWhereInput>(filters.term, [
      "product.name",
      "product.sku",
      "variant.sku",
      "variant.barcode",
    ]),
  };
  const orderBy = sortBy(pagination, ["available_quantity", "updatedAt"], { updatedAt: "desc" } as const);

  const result = await paginate(pagination, {
    findMany: (page) =>
      prisma.stock.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, slug: true, thumbnail: true } },
          variant: true,
          business_location: LOCATION,
        },
        orderBy,
        ...page,
      }),
    count: () => prisma.stock.count({ where }),
  });
  return { meta: result.meta, data: result.data };
};

export const StockService = {
  // stock moves (used by products, locations, orders and purchases)
  ensureStockRows,
  reserve,
  release,
  commit,
  restock,
  unship,
  adjust,
  // endpoints
  getAvailability,
  getStocks,
  createAdjustment,
  getAdjustments,
};
