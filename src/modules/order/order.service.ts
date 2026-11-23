import type { Prisma } from "@prisma/client";
import { OrderStatus } from "@prisma/client";
import config from "@/config";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { contains, dateRange, money } from "@/helpers/queryHelper";
import { filterWhere, paginate, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { StockService } from "@/modules/stock/stock.service";
import {
  applySoldCount,
  applyStockForStatus,
  notifyCustomer,
  reserveLines,
  type LineForStock,
} from "./order.status";

/**
 * Orders: placing an order (storefront), the admin's order list and actions,
 * and public order tracking. What a status change does to stock, sold counts
 * and customer SMS lives in ./order.status.ts.
 */

export const ORDER_STATUSES = Object.values(OrderStatus);

const PAYMENT_TYPES = ["CASH_ON_DELIVERY", "DELIVERY_CHARGE", "FULL_PAYMENT"] as const;
type PaymentType = (typeof PAYMENT_TYPES)[number];

type PlaceOrderInput = {
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

export type ListFilters = {
  searchQuery?: string;
  sku?: string;
  filter?: string;
  startDate?: string;
  endDate?: string;
  is_called?: string;
  business_location_id?: string;
};

/** The user fields shown in an order's history, logs and notes. */
const USER_BRIEF = { select: { id: true, full_name: true, role: true } } as const;

/** What an admin order response includes. */
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

// ---------------------------------------------------------------- placing an order (storefront)

/** The cart lines → checked order lines with server-side prices. */
const buildOrderLines = async (cart: NonNullable<PlaceOrderInput["products"]>) => {
  const variantIds = cart.map((line) => line.selected_variant?._id).filter((id): id is string => !!id);
  if (variantIds.length !== cart.length) throw badRequest("Every cart item must have a valid variant.");

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { is_deleted: false, is_published: true } },
    include: { product: true },
  });

  return cart.map((line) => {
    const variant = variants.find((v) => v.id === line.selected_variant!._id);
    if (!variant) throw conflict("An item in your cart is no longer available. Please refresh your cart.");

    const product = variant.product;
    if (line.product && line.product !== product.id)
      throw badRequest("Cart item product and variant don't match.");

    const quantity = Math.floor(Number(line.total_quantity));
    if (!Number.isFinite(quantity) || quantity < 1)
      throw badRequest(`Invalid quantity for "${product.name}".`);
    if (product.min_order_qty && quantity < product.min_order_qty) {
      throw badRequest(`Minimum order for "${product.name}" is ${product.min_order_qty}.`);
    }
    if (product.max_order_qty && quantity > product.max_order_qty) {
      throw badRequest(`Maximum order for "${product.name}" is ${product.max_order_qty}.`);
    }

    // The sale price if there is one, otherwise the regular price.
    const salePrice = variant.sale_price.toNumber();
    const unitPrice = salePrice > 0 ? salePrice : variant.regular_price.toNumber();

    return {
      product_id: product.id,
      variant_id: variant.id,
      variant_sku: variant.sku,
      product_name: product.name,
      total_quantity: quantity,
      unit_price: unitPrice,
      total_price: money(unitPrice * quantity),
      shipping_cost: product.shipping_cost,
      shipping_cost_per_unit: product.shipping_cost_per_unit,
      is_free_delivery: product.is_free_delivery,
      coin_per_order: product.coin_per_order,
      // A copy of the variant as it was when ordered.
      selected_variant: {
        _id: variant.id,
        attributes: variant.attributes,
        attribute_values: variant.attribute_values,
        regular_price: variant.regular_price.toNumber(),
        sale_price: salePrice,
        sku: variant.sku,
        barcode: variant.barcode,
      } as Prisma.InputJsonValue,
    };
  });
};

/**
 * Create an order. Prices, totals and the delivery charge are worked out on the
 * server; the client's total is only used to notice a stale cart. The order, its
 * lines and the stock reservation are saved in one transaction.
 */
const placeOrder = async (body: PlaceOrderInput) => {
  if (body.coupon) throw badRequest("Coupons aren't available yet. Please remove the coupon and try again.");
  const cart = body.products ?? [];
  if (!cart.length) throw badRequest("Your cart is empty.");

  const items = await buildOrderLines(cart);

  // Delivery: free only if every item is free-delivery; otherwise one of the configured rates.
  const deliveryRates = [config.delivery.insideDhaka, config.delivery.outsideDhaka];
  let delivery_charge = 0;
  if (items.some((item) => !item.is_free_delivery)) {
    const requested = Number(body.delivery_charge ?? 0);
    if (!deliveryRates.includes(requested)) {
      throw badRequest(`Please choose a delivery area (Tk ${deliveryRates.join(" or Tk ")}).`);
    }
    delivery_charge = requested;
  }

  const sub_total = money(items.reduce((sum, item) => sum + item.total_price, 0));
  const total_amount = money(sub_total + delivery_charge);
  if (body.total_amount !== undefined && money(Number(body.total_amount)) !== total_amount) {
    throw conflict(
      `Prices have changed (new total Tk ${total_amount}). Please refresh your cart and try again.`
    );
  }

  // How much the customer pays now (the rest is cash on delivery).
  const payment_type = (body.payment_type ?? "CASH_ON_DELIVERY") as PaymentType;
  if (!PAYMENT_TYPES.includes(payment_type)) throw badRequest("Invalid payment type.");
  let payNow = 0;
  if (payment_type === "FULL_PAYMENT") payNow = total_amount;
  if (payment_type === "DELIVERY_CHARGE") payNow = delivery_charge;
  if (payNow > 0 && !(body.files?.length || body.payment_id)) {
    throw badRequest("Please provide your payment transaction ID or screenshot.");
  }

  const customerName = String(body.customer_name ?? "").trim();
  const customerPhone = String(body.customer_phone ?? "").replace(/[^\d+]/g, "");
  if (!customerName) throw badRequest("Customer name is required.");
  if (customerPhone.replace(/\D/g, "").length < 11) throw badRequest("Please enter a valid phone number.");
  if (!String(body.delivery_address?.address ?? "").trim()) throw badRequest("Delivery address is required.");

  const manualPaymentInfo =
    payNow > 0
      ? {
          payment_method: body.payment_method ?? null,
          trxId: body.payment_id ?? null,
          sender_number: body.sender_number ?? null,
          paid_amount: payNow,
          files: body.files ?? [],
        }
      : undefined;

  const order = await prisma.$transaction(async (tx) => {
    // Reserve stock first: order numbers can't be "given back", so only take one once stock is secured.
    const allocations = await reserveLines(tx, items as unknown as LineForStock[]);

    const [{ serial }] = await tx.$queryRaw<{ serial: bigint }[]>`
      SELECT nextval(pg_get_serial_sequence('orders', 'order_serial_id')) AS serial`;
    const orderNumber = Number(serial);

    return tx.order.create({
      data: {
        order_serial_id: orderNumber,
        invoice_number: `INV-${orderNumber}`,
        order_by: "GUEST",
        customer_name: customerName,
        customer_phone: customerPhone,
        delivery_address: (body.delivery_address ?? {}) as Prisma.InputJsonValue,
        order_note: body.order_note,
        status: "PLACED",
        payment_type,
        manual_payment_info: manualPaymentInfo,
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

// ---------------------------------------------------------------- admin: lists

/** The admin's order filters → a Prisma `where`. `withStatus: false` ignores the status tab. */
const buildOrderWhere = (filters: ListFilters, withStatus: boolean): Prisma.OrderWhereInput => {
  const isValidStatus = !!filters.filter && ORDER_STATUSES.includes(filters.filter as OrderStatus);
  const calledFilter =
    filters.is_called === "true" ? true : filters.is_called === "false" ? false : undefined;

  const where: Prisma.OrderWhereInput = {
    is_deleted: false,
    ...filterWhere<Prisma.OrderWhereInput>({
      status: withStatus && isValidStatus ? (filters.filter as OrderStatus) : undefined,
      order_date: dateRange(filters.startDate, filters.endDate),
      is_called: calledFilter,
      assigned_business_location_id: filters.business_location_id,
    }),
  };

  if (filters.sku) where.products = { some: { variant_sku: contains(filters.sku) } };

  if (filters.searchQuery) {
    // "1007" or "INV-1007" also matches the order number.
    const orderNumber = Number(filters.searchQuery.replace(/^INV-/i, ""));
    const isOrderNumber = Number.isInteger(orderNumber) && orderNumber > 0 && orderNumber < 2 ** 31;
    where.OR = [
      { customer_name: contains(filters.searchQuery) },
      { customer_phone: contains(filters.searchQuery) },
      { invoice_number: contains(filters.searchQuery) },
    ];
    if (isOrderNumber) where.OR.push({ order_serial_id: orderNumber });
  }

  return where;
};

/** Order count per status — the admin's tabs: { all, placed, in_review, …, full_returned }. */
const statusCounts = async (filters: ListFilters) => {
  const groups = await prisma.order.groupBy({
    by: ["status"],
    where: buildOrderWhere(filters, false),
    _count: { _all: true },
  });

  const counts: Record<string, number> = { all: 0 };
  for (const status of ORDER_STATUSES) counts[status.toLowerCase()] = 0;
  for (const group of groups) {
    counts[group.status.toLowerCase()] = group._count._all;
    counts.all += group._count._all;
  }
  counts.full_returned = counts.returned;
  return counts;
};

/** Admin order list, newest first, with the status tab counts in `meta`. Sort: order_date, total_amount, order_serial_id. */
const list = async (pagination: IPagination, filters: ListFilters) => {
  const where = buildOrderWhere(filters, true);
  const orderBy = sortBy(pagination, ["order_date", "total_amount", "order_serial_id"], {
    order_date: "desc",
  } as const);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.order.findMany({ where, include: ADMIN_INCLUDE, orderBy, ...page }),
    count: () => prisma.order.count({ where }),
  });
  const status_total = await statusCounts(filters);

  return { meta: { ...result.meta, status_total }, data: result.data };
};

/** One order with its lines, history, logs and notes. */
const getById = async (id: string) => {
  const result = await prisma.order.findFirst({ where: { id, is_deleted: false }, include: ADMIN_INCLUDE });
  if (!result) throw notFound("Order");
  return result;
};

/** An order with what's needed to change its stock. */
const loadForUpdate = async (db: Db, id: string) => {
  const order = await db.order.findFirst({
    where: { id, is_deleted: false },
    include: { products: true, stock_allocations: true },
  });
  if (!order) throw notFound("Order");
  return order;
};

// ---------------------------------------------------------------- admin: actions

/** Change an order's status: moves stock, updates sold counts, logs it, texts the customer. */
const updateStatus = async (id: string, status: OrderStatus, actorId: string) => {
  const changedOrder = await prisma.$transaction(async (tx) => {
    // Lock the order row so two admins can't move the same order's stock at once.
    await tx.$queryRaw`SELECT 1 FROM orders WHERE id = ${id} FOR UPDATE`;

    const order = await loadForUpdate(tx, id);
    if (order.status === status) return null; // nothing to do

    await applyStockForStatus(tx, order, status);
    await applySoldCount(tx, order.products, order.status, status);

    const data: Prisma.OrderUpdateInput = {
      status,
      status_history: { create: { status, changed_by_id: actorId } },
      logs: { create: { action: `Status changed from ${order.status} to ${status}`, user_id: actorId } },
    };
    if (status === "IN_REVIEW" && !order.confirmed_date) data.confirmed_date = new Date();
    if (status === "DELIVERED") data.paid_amount = order.total_amount; // cash collected on delivery

    await tx.order.update({ where: { id }, data });
    return order;
  });

  if (changedOrder) notifyCustomer(changedOrder, status);
  return getById(id);
};

/** Mark that the customer was called. */
const markCalled = async (id: string, actor: { id: string; name: string }) => {
  await loadForUpdate(prisma, id); // 404 if it doesn't exist
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

/** Add an internal admin note. */
const addNote = async (id: string, note: string, actorId: string) => {
  await loadForUpdate(prisma, id); // 404 if it doesn't exist
  await prisma.order.update({
    where: { id },
    data: { admin_notes: { create: { note, added_by_id: actorId } } },
  });
  return getById(id);
};

/** Soft delete. Stock the order still holds goes back on sale. */
const remove = async (id: string, actorId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const order = await loadForUpdate(tx, id);
    const holdsStock = order.stock_state === "RESERVED";
    if (holdsStock) await StockService.release(tx, order.stock_allocations);

    await tx.order.update({
      where: { id },
      data: {
        is_deleted: true,
        stock_state: holdsStock ? "RELEASED" : order.stock_state,
        logs: { create: { action: "Order deleted", user_id: actorId } },
      },
    });
  });
};

// ---------------------------------------------------------------- public tracking

/**
 * Public tracking by order number ("1007") or invoice ("INV-1007"). Order numbers
 * are guessable, so no personal data (name, phone, address) is returned.
 */
const track = async (ref: string) => {
  const orderNumber = Number(String(ref).trim().replace(/^INV-/i, ""));
  if (!Number.isInteger(orderNumber) || orderNumber <= 0 || orderNumber >= 2 ** 31) {
    throw badRequest("Please enter a valid order number.");
  }

  const order = await prisma.order.findFirst({
    where: { order_serial_id: orderNumber, is_deleted: false },
    include: {
      products: { include: { product: { select: { id: true, name: true, slug: true, thumbnail: true } } } },
      status_history: { orderBy: { changed_at: "asc" } },
    },
  });
  if (!order) throw notFound("Order with this number");

  return {
    id: order.id,
    order_serial_id: order.order_serial_id,
    invoice_number: order.invoice_number,
    status: order.status,
    order_date: order.order_date,
    order_note: order.order_note,
    tracking_code: null,
    status_history: order.status_history.map((entry) => ({
      status: entry.status,
      changed_at: entry.changed_at,
    })),
    products: order.products.map((line) => {
      const variant = line.selected_variant as {
        attribute_values?: unknown;
        sale_price?: number;
        sku?: string;
      };
      return {
        product: line.product,
        total_quantity: line.total_quantity,
        total_price: line.total_price,
        selected_variant: {
          attribute_values: variant.attribute_values,
          sale_price: variant.sale_price,
          sku: variant.sku,
        },
      };
    }),
    sub_total: order.sub_total,
    delivery_charge: order.delivery_charge,
    total_amount: order.total_amount,
    payable_amount: order.payable_amount,
    paid_amount: order.paid_amount,
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
