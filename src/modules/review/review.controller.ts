import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { ReviewService } from "./review.service";

const ok = (res: Response, message: string, data: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });

const getProductReviews = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Reviews fetched successfully.", await ReviewService.getProductReviews(req.params.slug));
});

const getProductRating = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Rating fetched successfully.", await ReviewService.getProductRating(req.params.slug));
});

const create = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Thanks! Your review will appear once it is approved.",
    await ReviewService.create(req.body),
    httpStatus.CREATED
  );
});

const vote = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Thanks for your feedback.", await ReviewService.vote(req.params.id, req.body.vote));
});

// `data` = { data, meta } — the admin table reads data.data. The admin sends no
// page/limit yet, so the default page is large enough to show every review.
const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.getAll(paginationHelpers.calculatePagination(req, 100), {
    search: queryString(req, "searchQuery") ?? queryString(req, "search"),
    status: queryString(req, "status"),
    productId: queryString(req, "product"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviews fetched successfully.",
    data: result,
    meta: result.meta,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Review fetched successfully.", await ReviewService.getById(req.params.id));
});

const setStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.setStatus(req.params.id, req.body.status);
  auditLog(req, `review.status.${req.body.status}`, "review", req.params.id);
  ok(res, "Review status updated.", result);
});

const reply = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.reply(req.params.id, req.body.content);
  auditLog(req, "review.reply", "review", req.params.id);
  ok(res, "Reply saved.", result);
});

const remove = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.remove(req.params.id);
  auditLog(req, "review.delete", "review", req.params.id);
  ok(res, "Review deleted.", result);
});

export const ReviewController = {
  getProductReviews,
  getProductRating,
  create,
  vote,
  getAll,
  getById,
  setStatus,
  reply,
  remove,
};
