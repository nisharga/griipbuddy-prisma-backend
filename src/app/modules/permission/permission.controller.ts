import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { PermissionService } from "./permission.service";

const setPermissions = catchAsync(async (req: Request, res: Response) => {
  const result = await PermissionService.setPermissions(req.body.id, req.body.permissions);
  auditLog(req, "permissions.update", "permissions", req.body.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Permissions updated successfully.",
    data: result,
  });
});

export const PermissionController = { setPermissions };
