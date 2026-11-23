import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { money, numberRange } from "@/helpers/queryHelper";
import { filterWhere, searchWhere } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { SOLD_STATUSES } from "./stock.service";

/**
 * Stock reports for the admin's Check Outlet Stocks page:
 *   getStockReport   — one row per variant (quantities summed over the chosen
 *                      locations) plus totals per category / sub-category
 *   getVariantReport — one variant: stock per location, sibling variants, history
 *
 * Purchase price = weighted average cost from received purchases.
 */

/** The location fields shown in the reports. */
const LOCATION = { select: { id: true, name: true, type: true } } as const;

/** Fields the report can be sorted by. */
const REPORT_SORTS = ["available_quantity", "total_sold", "sale_price", "sku", "name"];

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

/** Totals for one category or sub-category. */
type Bucket = {
  _id: string;
  name: string;
  total_available_quantity: number;
  total_sold: number;
  total_current_stock_purchase_value: number;
  total_sale_value: number;
};

// ---------------------------------------------------------------- numbers per variant

/** Units sold per variant (from orders in a "sold" status). */
const soldByVariant = async (variantIds: string[]): Promise<Map<string, number>> => {
  if (!variantIds.length) return new Map();

  const groups = await prisma.orderItem.groupBy({
    by: ["variant_id"],
    where: { variant_id: { in: variantIds }, order: { status: { in: SOLD_STATUSES } } },
    _sum: { total_quantity: true },
  });
  return new Map(groups.map((group) => [group.variant_id, group._sum.total_quantity ?? 0]));
};

/** Average purchase cost per unit, per variant (received purchases: line totals ÷ units). */
const avgCostByVariant = async (variantIds: string[]): Promise<Map<string, number>> => {
  if (!variantIds.length) return new Map();

  const groups = await prisma.purchaseItem.groupBy({
    by: ["variant_id"],
    where: { variant_id: { in: variantIds }, purchase: { stock_applied: true } },
    _sum: { qty: true, line_total: true },
  });
  return new Map(
    groups.map((group) => {
      const units = group._sum.qty ?? 0;
      const totalCost = group._sum.line_total?.toNumber() ?? 0;
      return [group.variant_id, units ? money(totalCost / units) : 0];
    })
  );
};

// ---------------------------------------------------------------- stock report

/** The variant filter for the report. */
const buildReportWhere = (filters: StockReportFilters): Prisma.ProductVariantWhereInput => {
  const where: Prisma.ProductVariantWhereInput = {
    product: {
      is_deleted: false,
      ...filterWhere<Prisma.ProductWhereInput>({
        is_published: filters.isPublished,
        category_id: filters.categoryId,
        subcategory_id: filters.subcategoryId,
      }),
    },
    ...filterWhere<Prisma.ProductVariantWhereInput>({
      sale_price: numberRange(filters.minPrice, filters.maxPrice),
    }),
    // Both searches must match (each is an OR over several fields).
    AND: [
      searchWhere<Prisma.ProductVariantWhereInput>(filters.q, [
        "product.name",
        "product.sku",
        "sku",
        "barcode",
      ]),
      searchWhere<Prisma.ProductVariantWhereInput>(filters.sku, ["sku", "barcode", "product.sku"]),
    ],
  };
  if (filters.locationIds?.length) {
    where.stocks = { some: { business_location_id: { in: filters.locationIds } } };
  }
  return where;
};

/** Add one report row to its category's / sub-category's totals. */
const addToBucket = (
  buckets: Map<string, Bucket>,
  group: { id: string; name: string } | null,
  row: { available_quantity: number; total_sold: number; avg_purchase_price: number; sale_price: number }
) => {
  const key = group?.id ?? "uncategorized";
  const bucket = buckets.get(key) ?? {
    _id: key,
    name: group?.name ?? "Uncategorized",
    total_available_quantity: 0,
    total_sold: 0,
    total_current_stock_purchase_value: 0,
    total_sale_value: 0,
  };
  bucket.total_available_quantity += row.available_quantity;
  bucket.total_sold += row.total_sold;
  bucket.total_current_stock_purchase_value = money(
    bucket.total_current_stock_purchase_value + row.available_quantity * row.avg_purchase_price
  );
  bucket.total_sale_value = money(bucket.total_sale_value + row.available_quantity * row.sale_price);
  buckets.set(key, bucket);
};

/**
 * One row per variant with quantities summed over the chosen locations, plus a
 * summary over EVERY matching row (not just this page).
 */
const getStockReport = async (pagination: IPagination, filters: StockReportFilters) => {
  const locationFilter: Prisma.StockWhereInput = filters.locationIds?.length
    ? { business_location_id: { in: filters.locationIds } }
    : {};

  // 1. Load the matching variants with their stock at the chosen locations.
  const variants = await prisma.productVariant.findMany({
    where: buildReportWhere(filters),
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
        where: locationFilter,
        select: { available_quantity: true, reserved_quantity: true, business_location: LOCATION },
      },
    },
  });

  // 2. Units sold and average cost for those variants.
  const variantIds = variants.map((variant) => variant.id);
  const soldMap = await soldByVariant(variantIds);
  const costMap = await avgCostByVariant(variantIds);

  // 3. Build one report row per variant.
  const rows = variants.map((variant) => {
    const { category, subcategory, ...product } = variant.product;
    const avgCost = costMap.get(variant.id) ?? 0;

    return {
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      attribute_values: variant.attribute_values,
      regular_price: variant.regular_price.toNumber(),
      sale_price: variant.sale_price.toNumber(),
      purchase_price: avgCost,
      avg_purchase_price: avgCost,
      available_quantity: variant.stocks.reduce((sum, stock) => sum + stock.available_quantity, 0),
      reserved_quantity: variant.stocks.reduce((sum, stock) => sum + stock.reserved_quantity, 0),
      total_sold: soldMap.get(variant.id) ?? 0,
      product: {
        ...product,
        category: category ? { id: category.id, name: category.name_en } : null,
        subcategory: subcategory ? { id: subcategory.id, name: subcategory.name_en } : null,
      },
      // Only locations that actually have stock.
      stocks_by_location: variant.stocks
        .filter((stock) => stock.available_quantity > 0)
        .map((stock) => ({
          location: stock.business_location,
          available_quantity: stock.available_quantity,
          reserved_quantity: stock.reserved_quantity,
        })),
    };
  });

  // 4. Totals: overall, per category and per sub-category.
  const byCategory = new Map<string, Bucket>();
  const bySubcategory = new Map<string, Bucket>();
  let totalAvailable = 0;
  let totalSold = 0;
  let totalSaleValue = 0;
  let totalSoldValue = 0;
  let totalPurchaseValue = 0;

  for (const row of rows) {
    addToBucket(byCategory, row.product.category, row);
    addToBucket(bySubcategory, row.product.subcategory, row);
    totalAvailable += row.available_quantity;
    totalSold += row.total_sold;
    totalSaleValue += row.available_quantity * row.sale_price;
    totalPurchaseValue += row.available_quantity * row.avg_purchase_price;
    totalSoldValue += row.total_sold * row.sale_price;
  }

  const summation = {
    total_products: rows.length,
    total_available_quantity: totalAvailable,
    total_sold: totalSold,
    total_current_stock_purchase_value: money(totalPurchaseValue),
    total_sale_value: money(totalSaleValue),
    total_sold_value: money(totalSoldValue),
    summary_by_category: [...byCategory.values()],
    summary_by_subcategory: [...bySubcategory.values()],
  };

  // 5. Sort (default: most stock first), then cut out the requested page.
  const sortField =
    filters.sortBy && REPORT_SORTS.includes(filters.sortBy) ? filters.sortBy : "available_quantity";
  const direction = filters.sortOrder === "asc" ? 1 : -1;
  const sortValue = (row: (typeof rows)[number]): string | number =>
    sortField === "name" ? row.product.name : (row[sortField as keyof typeof row] as string | number);

  rows.sort((a, b) => {
    const x = sortValue(a);
    const y = sortValue(b);
    const compared = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
    return compared * direction;
  });

  return {
    meta: paginationHelpers.buildMeta(pagination, rows.length),
    summation,
    data: rows.slice(pagination.skip, pagination.skip + pagination.limit),
  };
};

// ---------------------------------------------------------------- one variant

/** One variant: stock per location, its sibling variants, and recent stock movements. */
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

  const limit = Math.min(Math.max(1, movementsLimit), 200);

  // Manual adjustments of this variant.
  const adjustments = await prisma.stockAdjustmentItem.findMany({
    where: { variant_id: variantId },
    include: {
      stock_adjustment: {
        select: { action: true, note: true, createdAt: true, business_location: LOCATION },
      },
    },
    orderBy: { stock_adjustment: { createdAt: "desc" } },
    take: limit,
  });

  // Received purchases of this variant.
  const purchases = await prisma.purchaseItem.findMany({
    where: { variant_id: variantId, purchase: { stock_applied: true } },
    include: {
      purchase: {
        select: {
          purchase_number: true,
          additional_notes: true,
          received_at: true,
          createdAt: true,
          business_location: LOCATION,
        },
      },
    },
    orderBy: { purchase: { received_at: "desc" } },
    take: limit,
  });

  const siblingIds = variant.product.variants.map((sibling) => sibling.id);
  const costMap = await avgCostByVariant(siblingIds);

  const { product, stocks, ...variantInfo } = variant;
  const { variants: siblings, ...productInfo } = product;

  // Adjustments and purchases in one list, newest first.
  const movements = [
    ...adjustments.map((item) => ({
      id: item.id,
      type: item.stock_adjustment.action,
      qty: item.quantity,
      old_quantity: item.old_quantity,
      new_quantity: item.new_quantity,
      note: item.product_note ?? item.stock_adjustment.note,
      cost_per_unit: null as number | null,
      business_location: item.stock_adjustment.business_location,
      variant: variantInfo,
      createdAt: item.stock_adjustment.createdAt,
    })),
    ...purchases.map((item) => ({
      id: item.id,
      type: "PURCHASE",
      qty: item.qty,
      old_quantity: null,
      new_quantity: null,
      note: item.purchase.additional_notes ?? `Purchase #${item.purchase.purchase_number}`,
      cost_per_unit: item.qty ? money(item.line_total.toNumber() / item.qty) : 0,
      business_location: item.purchase.business_location,
      variant: variantInfo,
      createdAt: item.purchase.received_at ?? item.purchase.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return {
    id: variantInfo.id,
    product: productInfo,
    variant: variantInfo,
    stocks_by_location: stocks.map((stock) => ({
      location: stock.business_location,
      available_quantity: stock.available_quantity,
      reserved_quantity: stock.reserved_quantity,
    })),
    avg_purchase_price: costMap.get(variantInfo.id) ?? 0,
    sibling_variants: siblings.map(({ stocks: siblingStocks, ...sibling }) => ({
      ...sibling,
      avg_purchase_price: costMap.get(sibling.id) ?? 0,
      available_quantity: siblingStocks.reduce((sum, stock) => sum + stock.available_quantity, 0),
    })),
    stock_movements: { data: movements },
  };
};

export const StockReportService = { getStockReport, getVariantReport };
