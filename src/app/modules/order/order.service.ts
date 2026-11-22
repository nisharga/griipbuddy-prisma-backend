import type { Prisma } from "@prisma/client";
import { OrderStatus, type StockState } from "@prisma/client";
import config from "@/config";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains, money } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";
import { enqueue } from "@/jobs/queue";
import { SOLD_STATUSES, StockService, type Allocation } from "@/app/modules/stock/stock.service";

export const ORDER_STATUSES = Object.values(OrderStatus);

// ------------------------------------------------------------------ status → stock & sales

const RELEASED: OrderStatus[] = ["CANCELLED", "FAILED", "RETURNED"];
const SHIPPED: OrderStatus[] = [
  "HANDED_OVER_TO_COURIER",
  "IN_TRANSIT",
  "DELIVERED",
  "RETURN_REQUESTED",
  "PENDING_RETURN",
];
const SOLD = SOLD_STATUSES;

const stockStateFor = (s: OrderStatus): StockState =>
  RELEASED.includes(s) ? "RELEASED" : SHIPPED.includes(s) ? "DEDUCTED" : "RESERVED";

type LineForStock = {
  variant_id: string;
  total_quantity: number;
  product_name: string;
  selected_variant: Prisma.JsonValue;
};

const lineLabel = (l: LineForStock) => {
  const attrs =
    (l.selected_variant as { attribute_values?: Record<string, string> } | null)?.attribute_values ?? {};
  return [l.product_name, Object.values(attrs).join(" / ")].filter(Boolean).join(" — ");
};

const reserveLines = (db: Db, lines: LineForStock[]) =>
  StockService.reserve(
    db,
    lines.map((l) => ({ variant_id: l.variant_id, quantity: l.total_quantity, label: lineLabel(l) }))
  );

/**
 * Move an order's stock to match its new status (inside the caller's transaction):
 *   RESERVED → held · DEDUCTED → shipped out · RELEASED → back on the shelf.
 */
const applyStockForStatus = async (
  tx: Db,
  order: { id: string; stock_state: StockState; products: LineForStock[]; stock_allocations: Allocation[] },
  status: OrderStatus
) => {
  const from = order.stock_state;
  const to = stockStateFor(status);
  if (from === to) return;
  const allocs = order.stock_allocations;

  if (from === "RESERVED" && to === "RELEASED") await StockService.release(tx, allocs);
  else if (from === "RESERVED" && to === "DEDUCTED") await StockService.commit(tx, allocs);
  else if (from === "DEDUCTED" && to === "RELEASED") await StockService.restock(tx, allocs);
  else if (from === "DEDUCTED" && to === "RESERVED") await StockService.unship(tx, allocs);
  else if (from === "RELEASED") {
    // Re-opening a cancelled/returned order: take the stock again (fails if it's gone).
    const fresh = await reserveLines(tx, order.products);
    if (to === "DEDUCTED") await StockService.commit(tx, fresh);
    await tx.orderStockAllocation.deleteMany({ where: { order_id: order.id } });
    await tx.orderStockAllocation.createMany({ data: fresh.map((a) => ({ ...a, order_id: order.id })) });
  }
  await tx.order.update({ where: { id: order.id }, data: { stock_state: to } });
};

const applySoldCount = async (
  tx: Db,
  lines: { product_id: string; total_quantity: number }[],
  from: OrderStatus,
  to: OrderStatus
) => {
  const delta = Number(SOLD.includes(to)) - Number(SOLD.includes(from));
  if (!delta) return;
  for (const l of lines) {
    await tx.product.update({
      where: { id: l.product_id },
      data: { total_sold: { increment: delta * l.total_quantity } },
    });
  }
};

// ------------------------------------------------------------------ customer notifications

const SMS_FOR: Partial<
  Record<OrderStatus, (o: { order_serial_id: number; total_amount: number }) => string>
> = {
  PLACED: (o) =>
    `Thank you! Your order #${o.order_serial_id} (Tk ${o.total_amount}) has been placed. We'll call you to confirm.`,
  HANDED_OVER_TO_COURIER: (o) => `Your order #${o.order_serial_id} has been handed over to the courier.`,
  DELIVERED: (o) => `Your order #${o.order_serial_id} has been delivered. Thank you for shopping with us!`,
  CANCELLED: (o) => `Your order #${o.order_serial_id} has been cancelled. Contact us if this is unexpected.`,
};

const notifyCustomer = (
  o: { customer_phone: string; order_serial_id: number; total_amount: Prisma.Decimal },
  status: OrderStatus
) => {
  const text = SMS_FOR[status]?.({
    order_serial_id: o.order_serial_id,
    total_amount: o.total_amount.toNumber(),
  });
  if (text) void enqueue("sms.send", { to: o.customer_phone, message: text });
};

// ------------------------------------------------------------------ placing an order (storefront)

type PlaceInput = {
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: { division?: string; district?: string; thana?: string; address?: string };
  order_note?: string;
  payment_type?: string;
  payment_id?: string;
  payment_method?: string;
  sender_number?: string;
  delivery_charge?: number;
  total_amount?: number;
  coupon?: string;
  files?: string[];
  products?: { product?: string; total_quantity?: number; selected_variant?: { _id?: string } }[];
};

const PAYMENT_TYPES = ["CASH_ON_DELIVERY", "DELIVERY_CHARGE", "FULL_PAYMENT"] as const;

/**
 * Create an order. Prices, totals and the delivery charge are computed on the
 * server; the client's total is only used to detect a stale cart. The order,
 * its lines and the stock reservation are written in one transaction.
 */
const placeOrder = async (body: PlaceInput) => {
  if (body.coupon) throw badRequest("Coupons aren't available yet. Please remove the coupon and try again.");
  const lines = body.products ?? [];
  if (!lines.length) throw badRequest("Your cart is empty.");

  const variantIds = lines.map((l) => l.selected_variant?._id).filter((id): id is string => !!id);
  if (variantIds.length !== lines.length) throw badRequest("Every cart item must have a valid variant.");
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { is_deleted: false, is_published: true } },
    include: { product: true },
  });

  const items = lines.map((l) => {
    const v = variants.find((x) => x.id === l.selected_variant!._id);
    if (!v) throw conflict("An item in your cart is no longer available. Please refresh your cart.");
    const p = v.product;
    if (l.product && l.product !== p.id) throw badRequest("Cart item product and variant don't match.");
    const qty = Math.floor(Number(l.total_quantity));
    if (!Number.isFinite(qty) || qty < 1) throw badRequest(`Invalid quantity for "${p.name}".`);
    if (p.min_order_qty && qty < p.min_order_qty)
      throw badRequest(`Minimum order for "${p.name}" is ${p.min_order_qty}.`);
    if (p.max_order_qty && qty > p.max_order_qty)
      throw badRequest(`Maximum order for "${p.name}" is ${p.max_order_qty}.`);

    const sale = v.sale_price.toNumber();
    const unit = sale > 0 ? sale : v.regular_price.toNumber();
    return {
      product_id: p.id,
      variant_id: v.id,
      variant_sku: v.sku,
      product_name: p.name,
      total_quantity: qty,
      unit_price: unit,
      total_price: money(unit * qty),
      shipping_cost: p.shipping_cost,
      shipping_cost_per_unit: p.shipping_cost_per_unit,
      is_free_delivery: p.is_free_delivery,
      coin_per_order: p.coin_per_order,
      selected_variant: {
        _id: v.id,
        attributes: v.attributes,
        attribute_values: v.attribute_values,
        regular_price: v.regular_price.toNumber(),
        sale_price: sale,
        sku: v.sku,
        barcode: v.barcode,
      } as Prisma.InputJsonValue,
    };
  });

  // Delivery: charged unless every item is free-delivery; must be one of the configured rates.
  const rates = [config.delivery.insideDhaka, config.delivery.outsideDhaka];
  let delivery_charge = 0;
  if (items.some((i) => !i.is_free_delivery)) {
    const requested = Number(body.delivery_charge ?? 0);
    if (!rates.includes(requested))
      throw badRequest(`Please choose a delivery area (Tk ${rates.join(" or Tk ")}).`);
    delivery_charge = requested;
  }

  const sub_total = money(items.reduce((s, i) => s + i.total_price, 0));
  const total_amount = money(sub_total + delivery_charge);
  if (body.total_amount !== undefined && money(Number(body.total_amount)) !== total_amount) {
    throw conflict(
      `Prices have changed (new total Tk ${total_amount}). Please refresh your cart and try again.`
    );
  }

  const payment_type = (body.payment_type ?? "CASH_ON_DELIVERY") as (typeof PAYMENT_TYPES)[number];
  if (!PAYMENT_TYPES.includes(payment_type)) throw badRequest("Invalid payment type.");
  const payNow =
    payment_type === "FULL_PAYMENT" ? total_amount : payment_type === "DELIVERY_CHARGE" ? delivery_charge : 0;
  if (payNow > 0 && !(body.files?.length || body.payment_id)) {
    throw badRequest("Please provide your payment transaction ID or screenshot.");
  }

  const name = String(body.customer_name ?? "").trim();
  const phone = String(body.customer_phone ?? "").replace(/[^\d+]/g, "");
  if (!name) throw badRequest("Customer name is required.");
  if (phone.replace(/\D/g, "").length < 11) throw badRequest("Please enter a valid phone number.");
  if (!String(body.delivery_address?.address ?? "").trim()) throw badRequest("Delivery address is required.");

  const order = await prisma.$transaction(async (tx) => {
    // Reserve first: sequences aren't transactional, so only take an order number once stock is secured.
    const allocations = await reserveLines(tx, items as unknown as LineForStock[]);
    const [{ serial }] = await tx.$queryRaw<{ serial: bigint }[]>`
      SELECT nextval(pg_get_serial_sequence('orders', 'order_serial_id')) AS serial`;
    const order_serial_id = Number(serial);
    return tx.order.create({
      data: {
        order_serial_id,
        invoice_number: `INV-${order_serial_id}`,
        order_by: "GUEST",
        customer_name: name,
        customer_phone: phone,
        delivery_address: (body.delivery_address ?? {}) as Prisma.InputJsonValue,
        order_note: body.order_note,
        status: "PLACED",
        payment_type,
        manual_payment_info:
          payNow > 0
            ? {
                payment_method: body.payment_method ?? null,
                trxId: body.payment_id ?? null,
                sender_number: body.sender_number ?? null,
                paid_amount: payNow,
                files: body.files ?? [],
              }
            : undefined,
        sub_total,
        delivery_charge,
        total_amount,
        payable_amount: payNow,
        paid_amount: 0, // becomes paid when an admin verifies the payment / on delivery
        COD: money(total_amount - payNow),
        stock_state: "RESERVED",
        products: { create: items },
        status_history: { create: { status: "PLACED" } },
        logs: { create: { action: "Order placed from website" } },
        stock_allocations: { create: allocations },
      },
      include: { products: true },
    });
  });
  notifyCustomer(order, "PLACED");
  return order;
};

// ------------------------------------------------------------------ admin

const USER_BRIEF = { select: { id: true, full_name: true, role: true } } as const;

const ADMIN_INCLUDE = {
  products: {
    include: { product: { select: { id: true, name: true, slug: true, thumbnail: true, sku: true } } },
  },
  status_history: { include: { changed_by: USER_BRIEF }, orderBy: { changed_at: "asc" as const } },
  logs: { include: { user: USER_BRIEF }, orderBy: { time: "asc" as const } },
  admin_notes: { include: { added_by: USER_BRIEF }, orderBy: { added_at: "asc" as const } },
  call_logs: { orderBy: { called_at: "asc" as const } },
  assigned_business_location: { select: { id: true, name: true, type: true } },
  user: { select: { id: true, full_name: true, phone_number: true, role: true } },
} satisfies Prisma.OrderInclude;

export type ListFilters = {
  searchQuery?: string;
  sku?: string;
  filter?: string;
  startDate?: string;
  endDate?: string;
  is_called?: string;
  business_location_id?: string;
};

const buildWhere = (f: ListFilters, withStatus: boolean): Prisma.OrderWhereInput => {
  const where: Prisma.OrderWhereInput = { is_deleted: false };
  if (withStatus && f.filter && ORDER_STATUSES.includes(f.filter as OrderStatus))
    where.status = f.filter as OrderStatus;
  if (f.startDate || f.endDate) {
    where.order_date = {
      ...(f.startDate ? { gte: new Date(`${f.startDate}T00:00:00`) } : {}),
      ...(f.endDate ? { lte: new Date(`${f.endDate}T23:59:59.999`) } : {}),
    };
  }
  if (f.is_called === "true" || f.is_called === "false") where.is_called = f.is_called === "true";
  if (f.business_location_id) where.assigned_business_location_id = f.business_location_id;
  if (f.sku) where.products = { some: { variant_sku: contains(f.sku) } };
  if (f.searchQuery) {
    const n = Number(f.searchQuery.replace(/^INV-/i, ""));
    where.OR = [
      { customer_name: contains(f.searchQuery) },
      { customer_phone: contains(f.searchQuery) },
      { invoice_number: contains(f.searchQuery) },
      ...(Number.isInteger(n) && n > 0 && n < 2 ** 31 ? [{ order_serial_id: n }] : []),
    ];
  }
  return where;
};

/** { all, placed, in_review, …, full_returned } — the admin's status tabs. */
const statusCounts = async (f: ListFilters) => {
  const rows = await prisma.order.groupBy({
    by: ["status"],
    where: buildWhere(f, false),
    _count: { _all: true },
  });
  const counts: Record<string, number> = { all: 0 };
  for (const s of ORDER_STATUSES) counts[s.toLowerCase()] = 0;
  for (const r of rows) {
    counts[r.status.toLowerCase()] = r._count._all;
    counts.all += r._count._all;
  }
  counts.full_returned = counts.returned;
  return counts;
};

const list = async (p: IPagination, f: ListFilters) => {
  const where = buildWhere(f, true);
  const [data, total, status_total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: ADMIN_INCLUDE,
      orderBy: { order_date: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.order.count({ where }),
    statusCounts(f),
  ]);
  return { meta: { ...paginationHelpers.buildMeta(p, total), status_total }, data };
};

const getById = async (id: string) => {
  const order = await prisma.order.findFirst({ where: { id, is_deleted: false }, include: ADMIN_INCLUDE });
  if (!order) throw notFound("Order");
  return order;
};

const loadForUpdate = async (tx: Db, id: string) => {
  const order = await tx.order.findFirst({
    where: { id, is_deleted: false },
    include: { products: true, stock_allocations: true },
  });
  if (!order) throw notFound("Order");
  return order;
};

const updateStatus = async (id: string, status: OrderStatus, actorId: string) => {
  const updated = await prisma.$transaction(async (tx) => {
    // Lock the order row so two admins can't move the same order's stock at once.
    await tx.$queryRaw`SELECT 1 FROM orders WHERE id = ${id} FOR UPDATE`;
    const order = await loadForUpdate(tx, id);
    if (order.status === status) return null;
    await applyStockForStatus(tx, order, status);
    await applySoldCount(tx, order.products, order.status, status);
    await tx.order.update({
      where: { id },
      data: {
        status,
        ...(status === "IN_REVIEW" && !order.confirmed_date ? { confirmed_date: new Date() } : {}),
        ...(status === "DELIVERED" ? { paid_amount: order.total_amount } : {}), // cash collected on delivery
        status_history: { create: { status, changed_by_id: actorId } },
        logs: { create: { action: `Status changed from ${order.status} to ${status}`, user_id: actorId } },
      },
    });
    return order;
  });
  if (updated) notifyCustomer(updated, status);
  return getById(id);
};

const markCalled = async (id: string, actor: { id: string; name: string }) => {
  await loadForUpdate(prisma, id);
  await prisma.order.update({
    where: { id },
    data: {
      is_called: true,
      call_logs: { create: { called_by_id: actor.id, called_by_name: actor.name } },
      logs: { create: { action: "Customer called", user_id: actor.id } },
    },
  });
  return getById(id);
};

const addNote = async (id: string, note: string, actorId: string) => {
  await loadForUpdate(prisma, id);
  await prisma.order.update({
    where: { id },
    data: { admin_notes: { create: { note, added_by_id: actorId } } },
  });
  return getById(id);
};

/** Soft delete; stock the order still holds goes back on sale. */
const remove = async (id: string, actorId: string) => {
  await prisma.$transaction(async (tx) => {
    const order = await loadForUpdate(tx, id);
    if (order.stock_state === "RESERVED") await StockService.release(tx, order.stock_allocations);
    await tx.order.update({
      where: { id },
      data: {
        is_deleted: true,
        stock_state: order.stock_state === "RESERVED" ? "RELEASED" : order.stock_state,
        logs: { create: { action: "Order deleted", user_id: actorId } },
      },
    });
  });
};

/**
 * Public tracking by order number ("1007") or invoice ("INV-1007"). Order numbers
 * are guessable, so no personal data (name, phone, address) is returned.
 */
const track = async (ref: string) => {
  const serial = Number(String(ref).trim().replace(/^INV-/i, ""));
  if (!Number.isInteger(serial) || serial <= 0 || serial >= 2 ** 31)
    throw badRequest("Please enter a valid order number.");
  const o = await prisma.order.findFirst({
    where: { order_serial_id: serial, is_deleted: false },
    include: {
      products: { include: { product: { select: { id: true, name: true, slug: true, thumbnail: true } } } },
      status_history: { orderBy: { changed_at: "asc" } },
    },
  });
  if (!o) throw notFound("Order with this number");
  return {
    id: o.id,
    order_serial_id: o.order_serial_id,
    invoice_number: o.invoice_number,
    status: o.status,
    order_date: o.order_date,
    order_note: o.order_note,
    tracking_code: null,
    status_history: o.status_history.map((h) => ({ status: h.status, changed_at: h.changed_at })),
    products: o.products.map((l) => {
      const v = l.selected_variant as { attribute_values?: unknown; sale_price?: number; sku?: string };
      return {
        product: l.product,
        total_quantity: l.total_quantity,
        total_price: l.total_price,
        selected_variant: { attribute_values: v.attribute_values, sale_price: v.sale_price, sku: v.sku },
      };
    }),
    sub_total: o.sub_total,
    delivery_charge: o.delivery_charge,
    total_amount: o.total_amount,
    payable_amount: o.payable_amount,
    paid_amount: o.paid_amount,
  };
};

export const OrderService = {
  placeOrder,
  list,
  statusCounts,
  getById,
  updateStatus,
  markCalled,
  addNote,
  remove,
  track,
};
