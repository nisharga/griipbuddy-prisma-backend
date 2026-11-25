import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { UserService } from "./user.service";

const adminLogin = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.adminLogin(req.body.phone_number, req.body.password);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged in successfully.",
    data: result,
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.refresh(req.body.refresh_token);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Token refreshed.", data: result });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  await UserService.logout(req.user!.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Logged out from all devices." });
});

const changeMyPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.changeMyPassword(
    req.user!.id,
    req.body.old_password,
    req.body.new_password
  );
  auditLog(req, "user.password_change_self", "user", req.user!.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed. Other devices have been logged out.",
    data: result,
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.forgotPassword(req.body.phone_number);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "If this number belongs to a staff account, a reset code has been sent.",
    data: result,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await UserService.resetPassword(req.body.phone_number, req.body.otp, req.body.new_password);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset. Please log in with your new password.",
  });
});

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getProfile(req.user!.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched successfully.",
    data: result,
  });
});

const createStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.createStaff(req.body);
  auditLog(req, "staff.create", "user", result.id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Staff created successfully.",
    data: result,
  });
});

/** ?role=ADMIN,SUPER_ADMIN&searchQuery=… — staff list, customer list, dropdowns. */
const getUsersByRoles = catchAsync(async (req: Request, res: Response) => {
  const roles = (queryString(req, "role") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const result = await UserService.listByRoles(
    paginationHelpers.calculatePagination(req),
    roles,
    queryString(req, "searchQuery")
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users fetched successfully.",
    data: result,
  });
});

const updateStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.updateStaff(req.params.id, req.body);
  auditLog(req, "staff.update", "user", req.params.id, { fields: Object.keys(req.body) });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff updated successfully.",
    data: result,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const { password, new_password, newPassword } = req.body;
  await UserService.changePassword(req.params.id, password || new_password || newPassword);
  auditLog(req, "user.password_change", "user", req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Password changed successfully." });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getProfile(req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User fetched successfully.",
    data: result,
  });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
  await UserService.deleteUser(req.params.id, req.user!.id);
  auditLog(req, "user.delete", "user", req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "User deleted successfully." });
});

export const UserController = {
  adminLogin,
  refreshToken,
  logout,
  changeMyPassword,
  forgotPassword,
  resetPassword,
  getMyProfile,
  createStaff,
  getUsersByRoles,
  updateStaff,
  changePassword,
  getUserById,
  deleteUser,
};
