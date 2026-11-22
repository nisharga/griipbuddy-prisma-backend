import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { SupplierService } from "./supplier.service";

// `data` is a plain array (purchase forms map over it); pagination in top-level `meta`.
// Without ?limit every supplier is returned (dropdowns).
const getAll = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await SupplierService.getAll(
    paginationHelpers.calculatePagination(req, req.query.limit ? 20 : 1000),
    queryString(req, "searchQuery") ?? queryString(req, "search")
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Suppliers fetched successfully.",
    data,
    meta,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Supplier fetched successfully.",
    data: await SupplierService.getById(req.params.id),
  });
});

const create = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Supplier created successfully.",
    data: await SupplierService.create(req.body),
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Supplier updated successfully.",
    data: await SupplierService.update(req.params.id, req.body),
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  await SupplierService.remove(req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Supplier deleted successfully." });
});

export const SupplierController = { getAll, getById, create, update, remove };
