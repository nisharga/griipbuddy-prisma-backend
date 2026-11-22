import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { RoleService } from "./role.service";

const getRoles = catchAsync(async (_req: Request, res: Response) => {
  const result = await RoleService.getRoles();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Roles fetched successfully.",
    data: result,
  });
});

const getRoleById = catchAsync(async (req: Request, res: Response) => {
  const result = await RoleService.getRoleById(req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Role fetched successfully.",
    data: result,
  });
});

const createRole = catchAsync(async (req: Request, res: Response) => {
  const result = await RoleService.createRole(req.body, req.user!.id);
  auditLog(req, "role.create", "role", result.id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Role created successfully.",
    data: result,
  });
});

const updateRole = catchAsync(async (req: Request, res: Response) => {
  const result = await RoleService.updateRole(req.params.id, req.body);
  auditLog(req, "role.update", "role", req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Role updated successfully.",
    data: result,
  });
});

const deleteRole = catchAsync(async (req: Request, res: Response) => {
  await RoleService.deleteRole(req.params.id);
  auditLog(req, "role.delete", "role", req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Role deleted successfully." });
});

export const RoleController = { getRoles, getRoleById, createRole, updateRole, deleteRole };
