import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { PurchaseService } from "./purchase.service";
import { PurchaseValidation } from "./purchase.validation";

const create = catchAsync(async (req: Request, res: Response) => {
  // validateRequest only checks; parse here to get defaults and coerced dates/numbers.
  const body = PurchaseValidation.createSchema.shape.body.parse(req.body);
  const result = await PurchaseService.create(body, req.user!.id);
  auditLog(req, "purchase.create", "purchase", result.id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Purchase added successfully.",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const body = PurchaseValidation.updateSchema.shape.body.parse(req.body);
  const result = await PurchaseService.update(req.params.id, body, req.user!.id);
  auditLog(req, "purchase.update", "purchase", req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchase updated successfully.",
    data: result,
  });
});

// `data` = { data, meta } — the purchase list reads data.data and data.meta.
const getAll = catchAsync(async (req: Request, res: Response) => {
  const number = queryString(req, "purchase_number");
  const result = await PurchaseService.getAll(paginationHelpers.calculatePagination(req, 20), {
    supplier: queryString(req, "supplier"),
    locationId: queryString(req, "business_location"),
    status: queryString(req, "status"),
    purchaseNumber: number ? Number(number) : undefined,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchases fetched successfully.",
    data: result,
    meta: result.meta,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchase fetched successfully.",
    data: await PurchaseService.getById(req.params.id),
  });
});

export const PurchaseController = { create, update, getAll, getById };
