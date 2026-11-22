import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { prisma } from "@/shared/prisma";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { OrderService, type ListFilters } from "./order.service";

const ok = (res: Response, message: string, data?: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });

const filters = (req: Request): ListFilters => ({
  searchQuery: queryString(req, "searchQuery"),
  sku: queryString(req, "sku"),
  filter: queryString(req, "filter"),
  startDate: queryString(req, "startDate"),
  endDate: queryString(req, "endDate"),
  is_called: queryString(req, "is_called"),
  business_location_id: queryString(req, "business_location_id"),
});

// ---------------------------------------------------------------- storefront (public)
const placeOrder = catchAsync(async (req: Request, res: Response) => {
  const o = await OrderService.placeOrder(req.body);
  // Only what the order-success page needs.
  ok(
    res,
    "Order placed successfully.",
    {
      id: o.id,
      order_serial_id: o.order_serial_id,
      invoice_number: o.invoice_number,
      status: o.status,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      delivery_address: o.delivery_address,
      products: o.products,
      sub_total: o.sub_total,
      delivery_charge: o.delivery_charge,
      total_amount: o.total_amount,
      payable_amount: o.payable_amount,
      COD: o.COD,
      payment_type: o.payment_type,
      order_date: o.order_date,
    },
    httpStatus.CREATED
  );
});

const trackOrder = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Order fetched successfully.", await OrderService.track(req.params.ref));
});

/** Whether this phone must pre-pay delivery. Always yes for now. */
const checkDeliveryChargeRequired = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Delivery charge requirement.", { required_delivery_charge: true });
});

// ---------------------------------------------------------------- admin
const getOrders = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Orders fetched successfully.",
    await OrderService.list(paginationHelpers.calculatePagination(req, 20), filters(req))
  );
});

const getStatusCounts = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Order status counts fetched successfully.", await OrderService.statusCounts(filters(req)));
});

const getOrderById = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Order fetched successfully.", await OrderService.getById(req.params.id));
});

const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderService.updateStatus(req.params.id, req.body.status, req.user!.id);
  auditLog(req, "order.status", "order", req.params.id, { status: req.body.status });
  ok(res, "Order status updated.", result);
});

const markDelivered = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderService.updateStatus(req.params.id, "DELIVERED", req.user!.id);
  auditLog(req, "order.status", "order", req.params.id, { status: "DELIVERED" });
  ok(res, "Order marked as delivered.", result);
});

const markCalled = catchAsync(async (req: Request, res: Response) => {
  const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { full_name: true } });
  ok(
    res,
    "Marked as called.",
    await OrderService.markCalled(req.params.id, { id: req.user!.id, name: me?.full_name ?? "" })
  );
});

const addNote = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Note added.", await OrderService.addNote(req.params.id, req.body.note, req.user!.id));
});

const deleteOrder = catchAsync(async (req: Request, res: Response) => {
  await OrderService.remove(req.params.id, req.user!.id);
  auditLog(req, "order.delete", "order", req.params.id);
  ok(res, "Order deleted successfully.");
});

export const OrderController = {
  placeOrder,
  trackOrder,
  checkDeliveryChargeRequired,
  getOrders,
  getStatusCounts,
  getOrderById,
  updateStatus,
  markDelivered,
  markCalled,
  addNote,
  deleteOrder,
};
