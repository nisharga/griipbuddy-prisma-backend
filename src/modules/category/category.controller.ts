import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { isStaffRequest } from "@/middlewares/auth";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { CategoryService } from "./category.service";

const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.getAll(
    paginationHelpers.calculatePagination(req, 20),
    isStaffRequest(req)
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Categories fetched successfully.",
    data: result,
  });
});

const getOne = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.getOne(req.params.idOrSlug);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category fetched successfully.",
    data: result,
  });
});

const create = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.create(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Category created successfully.",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.update(req.params.id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category updated successfully.",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  await CategoryService.remove(req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Category deleted successfully." });
});

export const CategoryController = { getAll, getOne, create, update, remove };
