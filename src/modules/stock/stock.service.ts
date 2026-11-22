import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains, dateRange, money } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";

/**
 * Stock rules (one row per variant × location):
 *   available_quantity — can be sold
 *   reserved_quantity  — held for placed orders that haven't shipped
 *
 * All functions take a Prisma client OR a transaction client, so callers can
 * group several stock moves with other writes in one atomic `$transaction`.
 * Every decrement is conditional (`WHERE available >= n`), and the database
 * also has CHECK (>= 0) constraints, so stock can never go negative.
 */

export type Allocation = { stock_id: string; variant_id: string; quantity: number };

/** Order statuses whose units count as sold (product `total_sold`, stock reports). */
export const SOLD_STATUSES: OrderStatus[] = ["DELIVERED", "RETURN_REQUESTED", "PENDING_RETURN"];

/** Give every variant × location pair in scope a stock row (quantity 0). Idempotent. */
const ensureStockRows = async (db: Db, scope: { variantIds?: string[]; locationIds?: string[] } = {}) => {
  const [variants, locations] = await Promise.all([
    db.productVariant.findMany({
      where: scope.variantIds ? { id: { in: scope.variantIds } } : {},
      select: { id: true, product_id: true },
    }),
    db.businessLocation.findMany({
      where: scope.locationIds ? { id: { in: scope.locationIds } } : {},
      select: { id: true },
    }),
  ]);
  const rows = variants.flatMap((v) =>
    locations.map((l) => ({ product_id: v.product_id, variant_id: v.id, business_location_id: l.id }))
  );
  if (rows.length) await db.stock.createMany({ data: rows, skipDuplicates: true });
};

/**
 * Reserve units for order lines, taking from the best-stocked locations first and
 * splitting across locations when needed. Throws 409 if anything is short — run
 * it inside a transaction so a failure undoes the lines already reserved.
 */
const reserve = async (db: Db, lines: { variant_id: string; quantity: number; label: string }[]) => {
  const taken: Allocation[] = [];
  for (const line of lines) {
    let remaining = line.quantity;
    const rows = await db.stock.findMany({
      where: { variant_id: line.variant_id, available_quantity: { gt: 0 } },
      orderBy: { available_quantity: "desc" },
    });
    for (const row of rows) {
      if (remaining <= 0) break;
      // Re-check under the update itself: another order may have taken units meanwhile.
      for (let qty = Math.min(remaining, row.available_quantity); qty > 0;) {
        const { count } = await db.stock.updateMany({
          where: { id: row.id, available_quantity: { gte: qty } },
          data: { available_quantity: { decrement: qty }, reserved_quantity: { increment: qty } },
        });
        if (count) {
          taken.push({ stock_id: row.id, variant_id: line.variant_id, quantity: qty });
          remaining -= qty;
          break;
        }
        const fresh = await db.stock.findUnique({
          where: { id: row.id },
          select: { available_quantity: true },
        });
        qty = Math.min(remaining, fresh?.available_quantity ?? 0);
      }
    }
    if (remaining > 0) {
      const got = line.quantity - remaining;
      throw conflict(
        got > 0
          ? `Only ${got} left in stock for "${line.label}". Please reduce the quantity.`
          : `"${line.label}" is out of stock.`
      );
    }
  }
  return taken;
};

const each = async (db: Db, allocs: Allocation[], data: (q: number) => object) => {
  for (const a of allocs) await db.stock.update({ where: { id: a.stock_id }, data: data(a.quantity) });
};

/** Reserved → back to available (order cancelled before shipping). */
const release = (db: Db, allocs: Allocation[]) =>
  each(db, allocs, (q) => ({ available_quantity: { increment: q }, reserved_quantity: { decrement: q } }));
/** Reserved → gone (order shipped). */
const commit = (db: Db, allocs: Allocation[]) =>
  each(db, allocs, (q) => ({ reserved_quantity: { decrement: q } }));
/** Shipped → back on the shelf (returned). */
const restock = (db: Db, allocs: Allocation[]) =>
  each(db, allocs, (q) => ({ available_quantity: { increment: q } }));
/** Shipped → reserved again (order moved back before shipping). */
const unship = (db: Db, allocs: Allocation[]) =>
  each(db, allocs, (q) => ({ reserved_quantity: { increment: q } }));

/** Manual adjustment of one stock row; returns [old, new] available quantity. */
const adjust = async (db: Db, stockId: string, action: "ADDITION" | "DEDUCTION", quantity: number) => {
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw badRequest("Quantity must be a whole number greater than 0.");
  const row = await db.stock.findUnique({ where: { id: stockId } });
  if (!row) throw notFound("Stock record");
  if (action === "DEDUCTION") {
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
  return [
    after.available_quantity + (action === "DEDUCTION" ? quantity : -quantity),
    after.available_quantity,
  ] as const;
};

/** Sellable units of a variant across all locations. */
const availableForVariant = async (variantId: string) => {
  const r = await prisma.stock.aggregate({
    where: { variant_id: variantId },
    _sum: { available_quantity: true },
  });
  return r._sum.available_quantity ?? 0;
};

// ------------------------------------------------------------------ endpoints

/** Storefront: availability of one variant per location. */
const getAvailability = async (productId: string, variantId: string) => {
  const stocks = await prisma.stock.findMany({
    where: { product_id: productId, variant_id: variantId },
    include: { business_location: { select: { id: true, name: true, type: true } } },
  });
  return { totalAvailableQuantity: stocks.reduce((s, r) => s + r.available_quantity, 0), stocks };
};

/** Stock rows (Stock Adjustment's product search). */
const getStocks = async (
  p: IPagination,
  f: { term?: string; locationId?: string; minQty?: number; maxQty?: number }
) => {
  const hasMin = Number.isFinite(f.minQty);
  const hasMax = Number.isFinite(f.maxQty);
  const where: Prisma.StockWhereInput = {
    product: { is_deleted: false },
    ...(f.locationId ? { business_location_id: f.locationId } : {}),
    ...(f.term
      ? {
          OR: [
            { product: { OR: [{ name: contains(f.term) }, { sku: contains(f.term) }] } },
            { variant: { OR: [{ sku: contains(f.term) }, { barcode: contains(f.term) }] } },
          ],
        }
      : {}),
    ...(hasMin || hasMax
      ? { available_quantity: { ...(hasMin ? { gte: f.minQty } : {}), ...(hasMax ? { lte: f.maxQty } : {}) } }
      : {}),
  };
  const [data, total] = await prisma.$transaction([
    prisma.stock.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, slug: true, thumbnail: true } },
        variant: true,
        business_location: { select: { id: true, name: true, type: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.stock.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), data };
};

// ------------------------------------------------------------------ stock report (Check Outlet Stocks)

const LOCATION = { select: { id: true, name: true, type: true } } as const;

/** Units sold per variant (orders in a SOLD status). */
const soldByVariant = async (variantIds: string[]) => {
  if (!variantIds.length) return new Map<string, number>();
  const rows = await prisma.orderItem.groupBy({
    by: ["variant_id"],
    where: { variant_id: { in: variantIds }, order: { status: { in: SOLD_STATUSES } } },
    _sum: { total_quantity: true },
  });
  return new Map(rows.map((r) => [r.variant_id, r._sum.total_quantity ?? 0]));
};

/** Weighted average cost per unit from received purchases (line totals ÷ units). */
const avgCostByVariant = async (variantIds: string[]) => {
  if (!variantIds.length) return new Map<string, number>();
  const rows = await prisma.purchaseItem.groupBy({
    by: ["variant_id"],
    where: { variant_id: { in: variantIds }, purchase: { stock_applied: true } },
    _sum: { qty: true, line_total: true },
  });
  return new Map(
    rows.map((r) => {
      const qty = r._sum.qty ?? 0;
      const total = r._sum.line_total?.toNumber() ?? 0;
      return [r.variant_id, qty ? money(total / qty) : 0];
    })
  );
};

export type StockReportFilters = {
  locationIds?: string[];
  q?: string;
  sku?: string;
  categoryId?: string;
  subcategoryId?: string;
  isPublished?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

const REPORT_SORTS = ["available_quantity", "total_sold", "sale_price", "sku", "name"] as const;

type Bucket = {
  _id: string;
  name: string;
  total_available_quantity: number;
  total_sold: number;
  total_current_stock_purchase_value: number;
  total_sale_value: number;
};

/**
 * One row per variant with quantities summed over the chosen locations, plus a
 * summary (totals, per category, per subcategory) over every matching row.
 * Purchase price = weighted average cost from received purchases.
 */
const getStockReport = async (p: IPagination, f: StockReportFilters) => {
  const locWhere: Prisma.StockWhereInput = f.locationIds?.length
    ? { business_location_id: { in: f.locationIds } }
    : {};
  const hasMin = Number.isFinite(f.minPrice);
  const hasMax = Number.isFinite(f.maxPrice);
  const where: Prisma.ProductVariantWhereInput = {
    product: {
      is_deleted: false,
      ...(f.isPublished !== undefined ? { is_published: f.isPublished } : {}),
      ...(f.categoryId ? { category_id: f.categoryId } : {}),
      ...(f.subcategoryId ? { subcategory_id: f.subcategoryId } : {}),
    },
    ...(f.locationIds?.length ? { stocks: { some: locWhere } } : {}),
    ...(hasMin || hasMax
      ? { sale_price: { ...(hasMin ? { gte: f.minPrice } : {}), ...(hasMax ? { lte: f.maxPrice } : {}) } }
      : {}),
    AND: [
      ...(f.q
        ? [
            {
              OR: [
                { product: { name: contains(f.q) } },
                { product: { sku: contains(f.q) } },
                { sku: contains(f.q) },
                { barcode: contains(f.q) },
              ],
            },
          ]
        : []),
      ...(f.sku
        ? [{ OR: [{ sku: contains(f.sku) }, { barcode: contains(f.sku) }, { product: { sku: contains(f.sku) } }] }]
        : []),
    ],
  };

  const variants = await prisma.productVariant.findMany({
    where,
    select: {
      id: true,
      sku: true,
      barcode: true,
      attribute_values: true,
      regular_price: true,
      sale_price: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          thumbnail: true,
          category: { select: { id: true, name_en: true } },
          subcategory: { select: { id: true, name_en: true } },
        },
      },
      stocks: {
        where: locWhere,
        select: { available_quantity: true, reserved_quantity: true, business_location: LOCATION },
      },
    },
  });
  const ids = variants.map((v) => v.id);
  const [sold, cost] = await Promise.all([soldByVariant(ids), avgCostByVariant(ids)]);

  const rows = variants.map((v) => {
    const sale_price = v.sale_price.toNumber();
    const { category, subcategory, ...product } = v.product;
    return {
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      attribute_values: v.attribute_values,
      regular_price: v.regular_price.toNumber(),
      sale_price,
      purchase_price: cost.get(v.id) ?? 0,
      avg_purchase_price: cost.get(v.id) ?? 0,
      available_quantity: v.stocks.reduce((s, r) => s + r.available_quantity, 0),
      reserved_quantity: v.stocks.reduce((s, r) => s + r.reserved_quantity, 0),
      total_sold: sold.get(v.id) ?? 0,
      product: {
        ...product,
        category: category ? { id: category.id, name: category.name_en } : null,
        subcategory: subcategory ? { id: subcategory.id, name: subcategory.name_en } : null,
      },
      stocks_by_location: v.stocks
        .filter((s) => s.available_quantity > 0)
        .map((s) => ({
          location: s.business_location,
          available_quantity: s.available_quantity,
          reserved_quantity: s.reserved_quantity,
        })),
    };
  });

  // summary over all matching rows (not just this page)
  const byCategory = new Map<string, Bucket>();
  const bySubcategory = new Map<string, Bucket>();
  const add = (map: Map<string, Bucket>, key: { id: string; name: string } | null, r: (typeof rows)[number]) => {
    const k = key?.id ?? "uncategorized";
    const b = map.get(k) ?? {
      _id: k,
      name: key?.name ?? "Uncategorized",
      total_available_quantity: 0,
      total_sold: 0,
      total_current_stock_purchase_value: 0,
      total_sale_value: 0,
    };
    b.total_available_quantity += r.available_quantity;
    b.total_sold += r.total_sold;
    b.total_current_stock_purchase_value = money(
      b.total_current_stock_purchase_value + r.available_quantity * r.avg_purchase_price
    );
    b.total_sale_value = money(b.total_sale_value + r.available_quantity * r.sale_price);
    map.set(k, b);
  };
  let total_available_quantity = 0;
  let total_sold = 0;
  let total_sale_value = 0;
  let total_sold_value = 0;
  let total_purchase_value = 0;
  for (const r of rows) {
    add(byCategory, r.product.category, r);
    add(bySubcategory, r.product.subcategory, r);
    total_available_quantity += r.available_quantity;
    total_sold += r.total_sold;
    total_sale_value += r.available_quantity * r.sale_price;
    total_purchase_value += r.available_quantity * r.avg_purchase_price;
    total_sold_value += r.total_sold * r.sale_price;
  }
  const summation = {
    total_products: rows.length,
    total_available_quantity,
    total_sold,
    total_current_stock_purchase_value: money(total_purchase_value),
    total_sale_value: money(total_sale_value),
    total_sold_value: money(total_sold_value),
    summary_by_category: [...byCategory.values()],
    summary_by_subcategory: [...bySubcategory.values()],
  };

  const sortBy = (REPORT_SORTS as readonly string[]).includes(f.sortBy ?? "") ? f.sortBy! : "available_quantity";
  const dir = f.sortOrder === "asc" ? 1 : -1;
  const key = (r: (typeof rows)[number]): string | number =>
    sortBy === "name" ? r.product.name : (r[sortBy as keyof typeof r] as string | number);
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * dir;
  });

  return {
    meta: paginationHelpers.buildMeta(p, rows.length),
    summation,
    data: rows.slice(p.skip, p.skip + p.limit),
  };
};

/** One variant: stock per location, its sibling variants, and recent adjustments. */
const getVariantReport = async (variantId: string, movementsLimit = 20) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          thumbnail: true,
          total_sold: true,
          warranty: true,
          sale_channels: true,
          variants: {
            select: {
              id: true,
              sku: true,
              attribute_values: true,
              regular_price: true,
              sale_price: true,
              stocks: { select: { available_quantity: true } },
            },
            orderBy: { serial: "asc" },
          },
        },
      },
      stocks: {
        select: { available_quantity: true, reserved_quantity: true, business_location: LOCATION },
        orderBy: { available_quantity: "desc" },
      },
    },
  });
  if (!variant) throw notFound("Product variant");

  const take = Math.min(Math.max(1, movementsLimit), 200);
  const [adjustments, purchases, cost] = await Promise.all([
    prisma.stockAdjustmentItem.findMany({
      where: { variant_id: variantId },
      include: {
        stock_adjustment: { select: { action: true, note: true, createdAt: true, business_location: LOCATION } },
      },
      orderBy: { stock_adjustment: { createdAt: "desc" } },
      take,
    }),
    prisma.purchaseItem.findMany({
      where: { variant_id: variantId, purchase: { stock_applied: true } },
      include: {
        purchase: {
          select: { purchase_number: true, additional_notes: true, received_at: true, createdAt: true, business_location: LOCATION },
        },
      },
      orderBy: { purchase: { received_at: "desc" } },
      take,
    }),
    avgCostByVariant(variant.product.variants.map((x) => x.id)),
  ]);

  const { product, stocks, ...v } = variant;
  const { variants, ...productInfo } = product;
  return {
    id: v.id,
    product: productInfo,
    variant: v,
    stocks_by_location: stocks.map((s) => ({
      location: s.business_location,
      available_quantity: s.available_quantity,
      reserved_quantity: s.reserved_quantity,
    })),
    avg_purchase_price: cost.get(v.id) ?? 0,
    sibling_variants: variants.map(({ stocks: st, ...sv }) => ({
      ...sv,
      avg_purchase_price: cost.get(sv.id) ?? 0,
      available_quantity: st.reduce((s, r) => s + r.available_quantity, 0),
    })),
    stock_movements: {
      data: [
        ...adjustments.map((m) => ({
          id: m.id,
          type: m.stock_adjustment.action,
          qty: m.quantity,
          old_quantity: m.old_quantity,
          new_quantity: m.new_quantity,
          note: m.product_note ?? m.stock_adjustment.note,
          cost_per_unit: null as number | null,
          business_location: m.stock_adjustment.business_location,
          variant: v,
          createdAt: m.stock_adjustment.createdAt,
        })),
        ...purchases.map((m) => ({
          id: m.id,
          type: "PURCHASE",
          qty: m.qty,
          old_quantity: null,
          new_quantity: null,
          note: m.purchase.additional_notes ?? `Purchase #${m.purchase.purchase_number}`,
          cost_per_unit: m.qty ? money(m.line_total.toNumber() / m.qty) : 0,
          business_location: m.purchase.business_location,
          variant: v,
          createdAt: m.purchase.received_at ?? m.purchase.createdAt,
        })),
      ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, take),
    },
  };
};

type AdjustmentInput = {
  business_location: string;
  action: "ADDITION" | "DEDUCTION";
  note?: string;
  products: { stock: string; quantity: number; product_note?: string; selected_variant?: unknown }[];
};

/** Apply a stock adjustment (several lines) as one transaction. */
const createAdjustment = async (input: AdjustmentInput, actorId: string) => {
  const stockIds = input.products.map((p) => p.stock);
  if (new Set(stockIds).size !== stockIds.length)
    throw badRequest("The same product variant is listed twice.");

  return prisma.$transaction(async (tx) => {
    const rows = await tx.stock.findMany({ where: { id: { in: stockIds } } });
    if (rows.length !== stockIds.length) throw notFound("One or more stock records");
    if (rows.some((r) => r.business_location_id !== input.business_location)) {
      throw badRequest("All products must belong to the selected business location.");
    }
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
    return tx.stockAdjustment.create({
      data: {
        business_location_id: input.business_location,
        action: input.action,
        note: input.note,
        adjust_by_id: actorId,
        total_amount: items.reduce((s, i) => s + i.quantity, 0),
        products: { create: items },
      },
      include: { products: true },
    });
  });
};

/** Adjustment history with product names on each line. */
const getAdjustments = async (
  p: IPagination,
  f: {
    action?: string;
    locationId?: string;
    adjustBy?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }
) => {
  const productIds = f.search
    ? (await prisma.product.findMany({ where: { name: contains(f.search) }, select: { id: true } })).map(
        (x) => x.id
      )
    : undefined;
  const dates = dateRange(f.startDate, f.endDate);
  const where: Prisma.StockAdjustmentWhereInput = {
    ...(f.action === "ADDITION" || f.action === "DEDUCTION" ? { action: f.action } : {}),
    ...(f.locationId ? { business_location_id: f.locationId } : {}),
    ...(f.adjustBy ? { adjust_by_id: f.adjustBy } : {}),
    ...(dates ? { activities_date: dates } : {}),
    ...(productIds ? { products: { some: { product_id: { in: productIds } } } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.stockAdjustment.findMany({
      where,
      include: {
        business_location: { select: { id: true, name: true, type: true } },
        adjust_by: { select: { id: true, full_name: true, role: true } },
        products: true,
      },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.stockAdjustment.count({ where }),
  ]);
  const ids = [...new Set(rows.flatMap((r) => r.products.map((i) => i.product_id)))];
  const names = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, sku: true, thumbnail: true },
  });
  const data = rows.map((r) => ({
    ...r,
    products: r.products.map(({ product_id, ...i }) => ({
      ...i,
      product: names.find((n) => n.id === product_id) ?? product_id,
    })),
  }));
  return { data, meta: paginationHelpers.buildMeta(p, total) };
};

export const StockService = {
  // inventory primitives (used by products, locations and orders)
  ensureStockRows,
  reserve,
  release,
  commit,
  restock,
  unship,
  adjust,
  availableForVariant,
  // endpoints
  getAvailability,
  getStocks,
  getStockReport,
  getVariantReport,
  createAdjustment,
  getAdjustments,
};
