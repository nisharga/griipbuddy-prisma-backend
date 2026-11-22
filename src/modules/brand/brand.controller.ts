import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { BrandService } from "./brand.service";

const getActive = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brands fetched successfully.",
    data: await BrandService.getActive(),
  });
});

const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await BrandService.getAll(
    paginationHelpers.calculatePagination(req),
    queryString(req, "searchTerm")
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brands fetched successfully.",
    data: result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand fetched successfully.",
    data: await BrandService.getById(req.params.id),
  });
});

const create = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Brand created successfully.",
    data: await BrandService.create(req.body),
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Brand updated successfully.",
    data: await BrandService.update(req.params.id, req.body),
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  await BrandService.remove(req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Brand deleted successfully." });
});

export const BrandController = { getActive, getAll, getById, create, update, remove };
