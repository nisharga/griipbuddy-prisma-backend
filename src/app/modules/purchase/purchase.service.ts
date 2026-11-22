import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { money } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";
import { StockService } from "@/app/modules/stock/stock.service";
import type { PurchaseInput, PurchaseUpdateInput } from "./purchase.validation";

/**
 * Purchases (stock bought from suppliers).
 * Stock is added to the purchase's location only while its status is "received"
 * (`stock_applied`). Editing or cancelling a received purchase first takes the old
 * quantities back out — which fails if those units have already been sold or moved —
 * then applies the new ones, all in one transaction.
 */

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

type Line = { product_id: string; variant_id: string; qty: number; unit_cost: number; discount: number; line_total: number };

/** Checks references and works out line and purchase totals. */
const prepare = async (
  db: Db,
  input: { business_location: string; supplier: string; items: PurchaseInput["items"]; expenses_applied?: PurchaseInput["expenses_applied"] }
) => {
  const [location, supplier] = await Promise.all([
    db.businessLocation.findUnique({ where: { id: input.business_location }, select: { id: true } }),
    db.supplier.findUnique({ where: { id: input.supplier }, select: { id: true } }),
  ]);
  if (!location) throw notFound("Business location");
  if (!supplier) throw notFound("Supplier");

  const variantIds = input.items.map((i) => i.variant);
  if (new Set(variantIds).size !== variantIds.length)
    throw badRequest("The same product variant is listed twice. Combine them into one line.");
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product_id: true, sku: true, product: { select: { is_deleted: true } } },
  });
  const lines: Line[] = input.items.map((i) => {
    const v = variants.find((x) => x.id === i.variant);
    if (!v || v.product.is_deleted) throw notFound(`Product variant ${i.variant}`);
    if (v.product_id !== i.product) throw badRequest(`Variant ${v.sku} does not belong to the selected product.`);
    return {
      product_id: v.product_id,
      variant_id: v.id,
      qty: i.qty,
      unit_cost: i.unit_cost,
      discount: i.discount,
      line_total: money(i.qty * i.unit_cost - i.discount),
    };
  });
  const items_total = money(lines.reduce((s, l) => s + l.line_total, 0));
  const expenses = input.expenses_applied ?? [];
  const expenses_total = money(expenses.reduce((s, e) => s + e.amount, 0));
  return { lines, expenses, items_total, expenses_total, total_cost: money(items_total + expenses_total) };
};

/** Add (+1) or take back (−1) a purchase's quantities at a location. */
const moveStock = async (tx: Db, locationId: string, lines: { variant_id: string; qty: number }[], sign: 1 | -1) => {
  await StockService.ensureStockRows(tx, { variantIds: lines.map((l) => l.variant_id), locationIds: [locationId] });
  for (const l of lines) {
    if (sign === 1) {
      await tx.stock.update({
        where: { variant_id_business_location_id: { variant_id: l.variant_id, business_location_id: locationId } },
        data: { available_quantity: { increment: l.qty } },
      });
      continue;
    }
    const { count } = await tx.stock.updateMany({
      where: { variant_id: l.variant_id, business_location_id: locationId, available_quantity: { gte: l.qty } },
      data: { available_quantity: { decrement: l.qty } },
    });
    if (!count) {
      const v = await tx.productVariant.findUnique({ where: { id: l.variant_id }, select: { sku: true } });
      throw badRequest(
        `Can't change this purchase: ${l.qty} units of ${v?.sku ?? l.variant_id} were received, but fewer are left in stock at this location (already sold or moved).`
      );
    }
  }
};

const create = async (input: PurchaseInput, actorId: string) => {
  const id = await prisma.$transaction(async (tx) => {
    const p = await prepare(tx, input);
    const received = input.status === "received";
    const purchase = await tx.purchase.create({
      data: {
        business_location_id: input.business_location,
        supplier_id: input.supplier,
        status: input.status,
        purchase_date: input.purchase_date,
        items_total: p.items_total,
        expenses_total: p.expenses_total,
        total_cost: p.total_cost,
        expenses_applied: p.expenses as Prisma.InputJsonValue,
        attachments: input.attachments ?? [],
        additional_notes: input.additional_notes,
        created_by_id: actorId,
        stock_applied: received,
        ...(received ? { received_by_id: actorId, received_at: new Date() } : {}),
        items: { create: p.lines },
      },
    });
    if (received) await moveStock(tx, input.business_location, p.lines, 1);
    return purchase.id;
  });
  return getById(id);
};

const update = async (id: string, input: PurchaseUpdateInput, actorId: string) => {
  await prisma.$transaction(async (tx) => {
    const current = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw notFound("Purchase");
    const locationId = input.business_location ?? current.business_location_id;
    const status = input.status ?? current.status;
    const p = await prepare(tx, {
      business_location: locationId,
      supplier: input.supplier ?? current.supplier_id,
      items: input.items,
      expenses_applied: input.expenses_applied,
    });

    if (current.stock_applied) await moveStock(tx, current.business_location_id, current.items, -1);
    const received = status === "received";
    if (received) await moveStock(tx, locationId, p.lines, 1);

    await tx.purchaseItem.deleteMany({ where: { purchase_id: id } });
    await tx.purchase.update({
      where: { id },
      data: {
        business_location_id: locationId,
        supplier_id: input.supplier ?? current.supplier_id,
        status,
        ...(input.purchase_date ? { purchase_date: input.purchase_date } : {}),
        items_total: p.items_total,
        expenses_total: p.expenses_total,
        total_cost: p.total_cost,
        ...(input.expenses_applied ? { expenses_applied: p.expenses as Prisma.InputJsonValue } : {}),
        ...(input.attachments ? { attachments: input.attachments } : {}),
        ...(input.additional_notes !== undefined ? { additional_notes: input.additional_notes } : {}),
        stock_applied: received,
        ...(received && !current.stock_applied ? { received_by_id: actorId, received_at: new Date() } : {}),
        ...(!received ? { received_by_id: null, received_at: null } : {}),
        items: { create: p.lines },
      },
    });
  });
  return getById(id);
};

const getAll = async (
  pg: IPagination,
  f: { supplier?: string; locationId?: string; status?: string; purchaseNumber?: number }
) => {
  const where: Prisma.PurchaseWhereInput = {
    ...(f.supplier ? { supplier_id: f.supplier } : {}),
    ...(f.locationId ? { business_location_id: f.locationId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(Number.isInteger(f.purchaseNumber) ? { purchase_number: f.purchaseNumber } : {}),
  };
  const [data, total] = await prisma.$transaction([
    prisma.purchase.findMany({
      where,
      include: INCLUDE,
      orderBy: { purchase_number: "desc" },
      skip: pg.skip,
      take: pg.limit,
    }),
    prisma.purchase.count({ where }),
  ]);
  return { data, meta: paginationHelpers.buildMeta(pg, total) };
};

const getById = async (id: string) => {
  const purchase = await prisma.purchase.findUnique({ where: { id }, include: INCLUDE });
  if (!purchase) throw notFound("Purchase");
  return purchase;
};

export const PurchaseService = { create, update, getAll, getById };
