import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { BusinessLocationService } from "./businessLocation.service";

const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await BusinessLocationService.getAll(paginationHelpers.calculatePagination(req, 100), {
    type: queryString(req, "type"),
    search: queryString(req, "searchQuery") ?? queryString(req, "search"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Business locations fetched successfully.",
    data: result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  const result = await BusinessLocationService.getById(req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Business location fetched successfully.",
    data: result,
  });
});

const create = catchAsync(async (req: Request, res: Response) => {
  const result = await BusinessLocationService.create(req.body);
  auditLog(req, "location.create", "business_location", result.id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Business location created successfully.",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const result = await BusinessLocationService.update(req.params.id, req.body);
  auditLog(req, "location.update", "business_location", req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Business location updated successfully.",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  await BusinessLocationService.remove(req.params.id);
  auditLog(req, "location.delete", "business_location", req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Business location deleted successfully.",
  });
});

export const BusinessLocationController = { getAll, getById, create, update, remove };
