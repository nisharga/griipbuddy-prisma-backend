import type { OrderStatus, Prisma, StockState } from "@prisma/client";
import type { Db } from "@/shared/prisma";
import { enqueue } from "@/jobs/queue";
import { SOLD_STATUSES, StockService, type Allocation } from "@/modules/stock/stock.service";

/**
 * What happens when an order's status changes:
 *   1. its stock moves      (reserved / shipped out / back on the shelf)
 *   2. products' "sold" counts go up or down
 *   3. the customer may get an SMS
 *
 * Stock state of an order:
 *   RESERVED  — units held for it (placed, in review …)
 *   DEDUCTED  — units have left the shelf (with the courier, delivered …)
 *   RELEASED  — units are back on the shelf (cancelled, failed, returned)
 */

const RELEASED_STATUSES: OrderStatus[] = ["CANCELLED", "FAILED", "RETURNED"];
const SHIPPED_STATUSES: OrderStatus[] = [
  "HANDED_OVER_TO_COURIER",
  "IN_TRANSIT",
  "DELIVERED",
  "RETURN_REQUESTED",
  "PENDING_RETURN",
];

/** An order line, with the fields the stock logic needs. */
export type LineForStock = {
  variant_id: string;
  total_quantity: number;
  product_name: string;
  selected_variant: Prisma.JsonValue;
};

/** The stock state an order should be in for a status. */
const stockStateFor = (status: OrderStatus): StockState => {
  if (RELEASED_STATUSES.includes(status)) return "RELEASED";
  if (SHIPPED_STATUSES.includes(status)) return "DEDUCTED";
  return "RESERVED";
};

/** "Runner Shoe — 42 / Black": product name + the variant's attribute values. */
const lineLabel = (line: LineForStock): string => {
  const variant = line.selected_variant as { attribute_values?: Record<string, string> } | null;
  const attributes = Object.values(variant?.attribute_values ?? {}).join(" / ");
  return [line.product_name, attributes].filter(Boolean).join(" — ");
};

/** Reserve stock for an order's lines (throws 409 if something is out of stock). */
export const reserveLines = (db: Db, lines: LineForStock[]) =>
  StockService.reserve(
    db,
    lines.map((line) => ({
      variant_id: line.variant_id,
      quantity: line.total_quantity,
      label: lineLabel(line),
    }))
  );

/**
 * Move an order's stock to match its new status (inside the caller's transaction).
 *
 *   from      → to        what happens
 *   RESERVED  → RELEASED  held units go back on sale            (release)
 *   RESERVED  → DEDUCTED  held units leave the shelf            (commit)
 *   DEDUCTED  → RELEASED  shipped units come back on the shelf  (restock)
 *   DEDUCTED  → RESERVED  shipped units are held again          (unship)
 *   RELEASED  → anything  take the stock again (fails if it's gone)
 */
export const applyStockForStatus = async (
  tx: Db,
  order: { id: string; stock_state: StockState; products: LineForStock[]; stock_allocations: Allocation[] },
  newStatus: OrderStatus
): Promise<void> => {
  const from = order.stock_state;
  const to = stockStateFor(newStatus);
  if (from === to) return;

  const allocations = order.stock_allocations;

  if (from === "RESERVED" && to === "RELEASED") await StockService.release(tx, allocations);
  else if (from === "RESERVED" && to === "DEDUCTED") await StockService.commit(tx, allocations);
  else if (from === "DEDUCTED" && to === "RELEASED") await StockService.restock(tx, allocations);
  else if (from === "DEDUCTED" && to === "RESERVED") await StockService.unship(tx, allocations);
  else if (from === "RELEASED") {
    // Re-opening a cancelled/returned order: reserve again, and replace the old allocations.
    const fresh = await reserveLines(tx, order.products);
    if (to === "DEDUCTED") await StockService.commit(tx, fresh);
    await tx.orderStockAllocation.deleteMany({ where: { order_id: order.id } });
    await tx.orderStockAllocation.createMany({
      data: fresh.map((allocation) => ({ ...allocation, order_id: order.id })),
    });
  }

  await tx.order.update({ where: { id: order.id }, data: { stock_state: to } });
};

/** Add to (or take back from) products' `total_sold` when an order enters (or leaves) a sold status. */
export const applySoldCount = async (
  tx: Db,
  lines: { product_id: string; total_quantity: number }[],
  oldStatus: OrderStatus,
  newStatus: OrderStatus
): Promise<void> => {
  const wasSold = SOLD_STATUSES.includes(oldStatus);
  const isSold = SOLD_STATUSES.includes(newStatus);
  if (wasSold === isSold) return;

  const direction = isSold ? 1 : -1;
  for (const line of lines) {
    await tx.product.update({
      where: { id: line.product_id },
      data: { total_sold: { increment: direction * line.total_quantity } },
    });
  }
};

// ---------------------------------------------------------------- customer SMS

type SmsOrder = { order_serial_id: number; total_amount: number };

/** The SMS a customer gets for each status (statuses not listed send nothing). */
const SMS_TEXT: Partial<Record<OrderStatus, (order: SmsOrder) => string>> = {
  PLACED: (order) =>
    `Thank you! Your order #${order.order_serial_id} (Tk ${order.total_amount}) has been placed. We'll call you to confirm.`,
  HANDED_OVER_TO_COURIER: (order) =>
    `Your order #${order.order_serial_id} has been handed over to the courier.`,
  DELIVERED: (order) =>
    `Your order #${order.order_serial_id} has been delivered. Thank you for shopping with us!`,
  CANCELLED: (order) =>
    `Your order #${order.order_serial_id} has been cancelled. Contact us if this is unexpected.`,
};

/** Queue the SMS for this status (sent in the background; never blocks the request). */
export const notifyCustomer = (
  order: { customer_phone: string; order_serial_id: number; total_amount: Prisma.Decimal },
  status: OrderStatus
): void => {
  const makeText = SMS_TEXT[status];
  if (!makeText) return;

  const message = makeText({
    order_serial_id: order.order_serial_id,
    total_amount: order.total_amount.toNumber(),
  });
  void enqueue("sms.send", { to: order.customer_phone, message });
};
