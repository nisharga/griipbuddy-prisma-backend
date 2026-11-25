import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { CustomerService } from "./customer.service";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message, data });

const sendOtp = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Code sent. Please check your SMS.", await CustomerService.sendOtp(req.body.phone_number));
});

const verifyOtp = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Logged in successfully.", await CustomerService.verifyOtp(req.body.phone_number, req.body.otp));
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Token refreshed.", await CustomerService.refresh(req.body.refresh_token));
});

const logout = catchAsync(async (req: Request, res: Response) => {
  await CustomerService.logout(req.user!.id);
  ok(res, "Logged out from all devices.", null);
});

const getMe = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Profile fetched successfully.", await CustomerService.getMe(req.user!.id));
});

const updateMe = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Profile updated successfully.", await CustomerService.updateMe(req.user!.id, req.body));
});

// `data` = { data, meta } — the storefront's profile page reads data.data.
const getMyOrders = catchAsync(async (req: Request, res: Response) => {
  const result = await CustomerService.getMyOrders(
    req.user!.id,
    paginationHelpers.calculatePagination(req, 20)
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Orders fetched successfully.",
    data: result,
    meta: result.meta,
  });
});

const getMyOrder = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Order fetched successfully.", await CustomerService.getMyOrder(req.user!.id, req.params.id));
});

export const CustomerController = {
  logout,
  sendOtp,
  verifyOtp,
  refreshToken,
  getMe,
  updateMe,
  getMyOrders,
  getMyOrder,
};
