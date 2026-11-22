import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { FaqService } from "./faq.service";

const getProductFaqs = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQs fetched successfully.",
    data: await FaqService.getProductFaqs(req.params.slug),
  });
});

const ask = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Thanks! Your question will appear once it is answered.",
    data: await FaqService.ask(req.body),
  });
});

// `data` = { faqs, meta } — the admin table reads data.faqs. The admin page sends no
// page/limit yet, so the default page is large enough to show every FAQ.
const getAll = catchAsync(async (req: Request, res: Response) => {
  const data = await FaqService.getAll(
    paginationHelpers.calculatePagination(req, 100),
    queryString(req, "searchQuery") ?? queryString(req, "search"),
    queryString(req, "status")
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQs fetched successfully.",
    data,
    meta: data.meta,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQ fetched successfully.",
    data: await FaqService.getById(req.params.id),
  });
});

const create = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "FAQ created successfully.",
    data: await FaqService.create(req.body, req.user?.id),
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "FAQ updated successfully.",
    data: await FaqService.update(req.params.id, req.body),
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  await FaqService.remove(req.params.id);
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "FAQ deleted successfully." });
});

export const FaqController = { getProductFaqs, ask, getAll, getById, create, update, remove };
