import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { SubCategoryService } from "./subCategory.service";

const ok = (res: Response, message: string, data?: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });

const getAll = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-categories fetched successfully.",
    await SubCategoryService.getAll(paginationHelpers.calculatePagination(req, 100))
  );
});
const getByCategoryId = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-categories fetched successfully.",
    await SubCategoryService.getByCategoryId(req.params.categoryId)
  );
});
const getByCategorySlug = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-categories fetched successfully.",
    await SubCategoryService.getByCategorySlug(req.params.slug)
  );
});
const getChildrenById = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-sub-categories fetched successfully.",
    await SubCategoryService.getChildrenById(req.params.id)
  );
});
const getChildrenBySlug = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-sub-categories fetched successfully.",
    await SubCategoryService.getChildrenBySlug(req.params.slug)
  );
});
const getOne = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Sub-category fetched successfully.", await SubCategoryService.getOne(req.params.idOrSlug));
});
const create = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-category created successfully.",
    await SubCategoryService.create(req.body),
    httpStatus.CREATED
  );
});
const createChild = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Sub-sub-category created successfully.",
    await SubCategoryService.createChild(req.body),
    httpStatus.CREATED
  );
});
const update = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Sub-category updated successfully.", await SubCategoryService.update(req.params.id, req.body));
});
const remove = catchAsync(async (req: Request, res: Response) => {
  await SubCategoryService.remove(req.params.id);
  ok(res, "Sub-category deleted successfully.");
});
const removeChild = catchAsync(async (req: Request, res: Response) => {
  await SubCategoryService.removeChild(req.params.id);
  ok(res, "Sub-sub-category deleted successfully.");
});

export const SubCategoryController = {
  getAll,
  getByCategoryId,
  getByCategorySlug,
  getChildrenById,
  getChildrenBySlug,
  getOne,
  create,
  createChild,
  update,
  remove,
  removeChild,
};
