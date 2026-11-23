import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, notFound } from "@/errors/ApiError";
import { money } from "@/helpers/queryHelper";
import { filterWhere, paginate, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { StockService } from "@/modules/stock/stock.service";
import type { PurchaseInput, PurchaseUpdateInput } from "./purchase.validation";

/**
 * Purchases: stock bought from a supplier into one location.
 *
 * Stock is added only while the purchase is "received" (`stock_applied`).
 * Editing or cancelling a received purchase first takes the old quantities back
 * out (fails if those units were already sold or moved), then adds the new ones —
 * all in one transaction, so it either fully happens or not at all.
 */

/** What a purchase response includes. */
const INCLUDE = {
  supplier: { select: { id: true, name: true, contact_id: true, phone: true, email: true, address: true } },
  business_location: { select: { id: true, name: true, type: true } },
  created_by: { select: { id: true, full_name: true } },
  received_by: { select: { id: true, full_name: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, thumbnail: true } },
      variant: { select: { id: true, sku: true, barcode: true, attribute_values: true, sale_price: true } },
    },
  },
} satisfies Prisma.PurchaseInclude;

/** One checked purchase line, ready to save. */
type Line = {
  product_id: string;
  variant_id: string;
  qty: number;
  unit_cost: number;
  discount: number;
  line_total: number;
};

// ---------------------------------------------------------------- helpers

/**
 * Checks the location, supplier and every item, then works out the totals.
 * line total = qty × unit cost − discount (the discount is for the whole line).
 */
const prepare = async (
  db: Db,
  input: {
    business_location: string;
    supplier: string;
    items: PurchaseInput["items"];
    expenses_applied?: PurchaseInput["expenses_applied"];
  }
) => {
  const location = await db.businessLocation.findUnique({
    where: { id: input.business_location },
    select: { id: true },
  });
  if (!location) throw notFound("Business location");

  const supplier = await db.supplier.findUnique({ where: { id: input.supplier }, select: { id: true } });
  if (!supplier) throw notFound("Supplier");

  const variantIds = input.items.map((item) => item.variant);
  if (new Set(variantIds).size !== variantIds.length) {
    throw badRequest("The same product variant is listed twice. Combine them into one line.");
  }

  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product_id: true, sku: true, product: { select: { is_deleted: true } } },
  });

  const lines: Line[] = input.items.map((item) => {
    const variant = variants.find((v) => v.id === item.variant);
    if (!variant || variant.product.is_deleted) throw notFound(`Product variant ${item.variant}`);
    if (variant.product_id !== item.product) {
      throw badRequest(`Variant ${variant.sku} does not belong to the selected product.`);
    }
    return {
      product_id: variant.product_id,
      variant_id: variant.id,
      qty: item.qty,
      unit_cost: item.unit_cost,
      discount: item.discount,
      line_total: money(item.qty * item.unit_cost - item.discount),
    };
  });

  const expenses = input.expenses_applied ?? [];
  const items_total = money(lines.reduce((sum, line) => sum + line.line_total, 0));
  const expenses_total = money(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const total_cost = money(items_total + expenses_total);

  return { lines, expenses, items_total, expenses_total, total_cost };
};

/** Add the lines' quantities to stock at a location. */
const addStock = async (tx: Db, locationId: string, lines: { variant_id: string; qty: number }[]) => {
  const variantIds = lines.map((line) => line.variant_id);
  await StockService.ensureStockRows(tx, { variantIds, locationIds: [locationId] });

  for (const line of lines) {
    await tx.stock.update({
      where: {
        variant_id_business_location_id: { variant_id: line.variant_id, business_location_id: locationId },
      },
      data: { available_quantity: { increment: line.qty } },
    });
  }
};

/** Take the lines' quantities back out of stock. Fails if some were already sold or moved. */
const removeStock = async (tx: Db, locationId: string, lines: { variant_id: string; qty: number }[]) => {
  for (const line of lines) {
    // Only subtract if enough is left (never below 0).
    const { count } = await tx.stock.updateMany({
      where: {
        variant_id: line.variant_id,
        business_location_id: locationId,
        available_quantity: { gte: line.qty },
      },
      data: { available_quantity: { decrement: line.qty } },
    });

    if (!count) {
      const variant = await tx.productVariant.findUnique({
        where: { id: line.variant_id },
        select: { sku: true },
      });
      const name = variant?.sku ?? line.variant_id;
      throw badRequest(
        `Can't change this purchase: ${line.qty} units of ${name} were received, but fewer are left in stock at this location (already sold or moved).`
      );
    }
  }
};

// ---------------------------------------------------------------- read

/** All purchases, newest number first. Filter: supplier, location, status, number. Sort: purchase_number, purchase_date, total_cost, createdAt. */
const getAll = async (
  pagination: IPagination,
  filters: { supplier?: string; locationId?: string; status?: string; purchaseNumber?: number }
) => {
  const where = filterWhere<Prisma.PurchaseWhereInput>({
    supplier_id: filters.supplier,
    business_location_id: filters.locationId,
    status: filters.status,
    purchase_number: Number.isInteger(filters.purchaseNumber) ? filters.purchaseNumber : undefined,
  });
  const orderBy = sortBy(pagination, ["purchase_number", "purchase_date", "total_cost", "createdAt"], {
    purchase_number: "desc",
  } as const);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.purchase.findMany({ where, include: INCLUDE, orderBy, ...page }),
    count: () => prisma.purchase.count({ where }),
  });
  return result;
};

/** One purchase by id. */
const getById = async (id: string) => {
  const result = await prisma.purchase.findUnique({ where: { id }, include: INCLUDE });
  if (!result) throw notFound("Purchase");
  return result;
};

// ---------------------------------------------------------------- write

/** A new purchase. If it's "received", its quantities go into stock now. */
const create = async (input: PurchaseInput, actorId: string) => {
  const purchaseId = await prisma.$transaction(async (tx) => {
    const prepared = await prepare(tx, input);
    const isReceived = input.status === "received";

    const purchase = await tx.purchase.create({
      data: {
        business_location_id: input.business_location,
        supplier_id: input.supplier,
        status: input.status,
        purchase_date: input.purchase_date,
        items_total: prepared.items_total,
        expenses_total: prepared.expenses_total,
        total_cost: prepared.total_cost,
        expenses_applied: prepared.expenses as Prisma.InputJsonValue,
        attachments: input.attachments ?? [],
        additional_notes: input.additional_notes,
        created_by_id: actorId,
        stock_applied: isReceived,
        received_by_id: isReceived ? actorId : null,
        received_at: isReceived ? new Date() : null,
        items: { create: prepared.lines },
      },
    });

    if (isReceived) await addStock(tx, input.business_location, prepared.lines);
    return purchase.id;
  });

  return getById(purchaseId);
};

/**
 * Edit a purchase. If it was received, the old quantities are taken out of stock
 * first; if it's received after the edit, the new quantities are added.
 */
const update = async (id: string, input: PurchaseUpdateInput, actorId: string) => {
  await prisma.$transaction(async (tx) => {
    const current = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw notFound("Purchase");

    // Fields not sent keep their current value.
    const locationId = input.business_location ?? current.business_location_id;
    const supplierId = input.supplier ?? current.supplier_id;
    const status = input.status ?? current.status;
    const isReceived = status === "received";

    const prepared = await prepare(tx, {
      business_location: locationId,
      supplier: supplierId,
      items: input.items,
      expenses_applied: input.expenses_applied,
    });

    // 1. Undo the old stock, 2. apply the new stock.
    if (current.stock_applied) await removeStock(tx, current.business_location_id, current.items);
    if (isReceived) await addStock(tx, locationId, prepared.lines);

    const data: Prisma.PurchaseUncheckedUpdateInput = {
      business_location_id: locationId,
      supplier_id: supplierId,
      status,
      items_total: prepared.items_total,
      expenses_total: prepared.expenses_total,
      total_cost: prepared.total_cost,
      stock_applied: isReceived,
    };
    if (input.purchase_date) data.purchase_date = input.purchase_date;
    if (input.expenses_applied) data.expenses_applied = prepared.expenses as Prisma.InputJsonValue;
    if (input.attachments) data.attachments = input.attachments;
    if (input.additional_notes !== undefined) data.additional_notes = input.additional_notes;

    // Who received it, and when: set when it becomes received, cleared when it no longer is.
    if (isReceived && !current.stock_applied) {
      data.received_by_id = actorId;
      data.received_at = new Date();
    }
    if (!isReceived) {
      data.received_by_id = null;
      data.received_at = null;
    }

    // Replace the lines.
    await tx.purchaseItem.deleteMany({ where: { purchase_id: id } });
    await tx.purchase.update({ where: { id }, data: { ...data, items: { create: prepared.lines } } });
  });

  return getById(id);
};

export const PurchaseService = { create, update, getAll, getById };
