import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { ReturnPolicyService } from "./returnPolicy.service";

const ok = (res: Response, message: string, data?: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });

const getActive = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Return policies fetched successfully.", await ReturnPolicyService.getActive());
});
const getAll = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Return policies fetched successfully.",
    await ReturnPolicyService.getAll(paginationHelpers.calculatePagination(req), queryString(req, "search"))
  );
});
const getById = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Return policy fetched successfully.", await ReturnPolicyService.getById(req.params.id));
});
const create = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Return policy created successfully.",
    await ReturnPolicyService.create(req.body),
    httpStatus.CREATED
  );
});
const toggleStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await ReturnPolicyService.toggleStatus(req.params.id);
  ok(res, `Return policy ${result.is_active ? "activated" : "deactivated"}.`, result);
});
const update = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Return policy updated successfully.", await ReturnPolicyService.update(req.params.id, req.body));
});
const remove = catchAsync(async (req: Request, res: Response) => {
  await ReturnPolicyService.remove(req.params.id);
  ok(res, "Return policy deleted successfully.");
});

export const ReturnPolicyController = { getActive, getAll, getById, create, toggleStatus, update, remove };
