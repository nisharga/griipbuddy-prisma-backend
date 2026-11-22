import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { StockService } from "./stock.service";

const getAvailability = catchAsync(async (req: Request, res: Response) => {
  const result = await StockService.getAvailability(req.params.productId, req.params.variantId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stock fetched successfully.",
    data: result,
  });
});

const getStocks = catchAsync(async (req: Request, res: Response) => {
  const result = await StockService.getStocks(paginationHelpers.calculatePagination(req, 20), {
    term: queryString(req, "sku") ?? queryString(req, "searchQuery"),
    locationId: queryString(req, "businessLocationId"),
    minQty: Number(req.query.minQty),
    maxQty: Number(req.query.maxQty),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stocks fetched successfully.",
    data: result,
  });
});

/** `?businessLocationIds=a,b` or repeated `?businessLocationIds=a&businessLocationIds=b`. */
const listParam = (req: Request, key: string) => {
  const raw = req.query[key];
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((v) => v.trim())
    .filter((v) => v && v !== "undefined" && v !== "null" && v !== "all");
  return values.length ? [...new Set(values)] : undefined;
};

const optionalNumber = (req: Request, ...keys: string[]) => {
  for (const k of keys) {
    const v = queryString(req, k);
    if (v !== undefined && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
};

/** Check Outlet Stocks: variant rows + summary (GET /business-location/stock/all and …/stock/category/subcategory). */
const getStockReport = catchAsync(async (req: Request, res: Response) => {
  const published = queryString(req, "isPublished");
  const result = await StockService.getStockReport(paginationHelpers.calculatePagination(req, 20), {
    locationIds: listParam(req, "businessLocationIds") ?? listParam(req, "businessLocationId"),
    q: queryString(req, "q"),
    sku: queryString(req, "sku"),
    categoryId: queryString(req, "categorybyId") ?? queryString(req, "categoryId"),
    subcategoryId: queryString(req, "subCategorybyId") ?? queryString(req, "subcategoryId"),
    isPublished: published === undefined ? undefined : published === "true",
    // `minpPice` / `maxPice` are the admin's (misspelled) param names
    minPrice: optionalNumber(req, "minPrice", "minpPice"),
    maxPrice: optionalNumber(req, "maxPrice", "maxPice"),
    sortBy: queryString(req, "sortBy"),
    sortOrder: queryString(req, "sortOrder") === "asc" ? "asc" : "desc",
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stock report fetched successfully.",
    data: result,
  });
});

const getVariantReport = catchAsync(async (req: Request, res: Response) => {
  const result = await StockService.getVariantReport(
    req.params.variantId,
    Number(req.query.stockMovementsLimit) || 20
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Variant stock fetched successfully.",
    data: result,
  });
});

const createAdjustment = catchAsync(async (req: Request, res: Response) => {
  const result = await StockService.createAdjustment(req.body, req.user!.id);
  auditLog(req, `stock.adjust.${String(req.body.action).toLowerCase()}`, "stock_adjustment", result.id);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Stock adjustment successful.",
    data: result,
  });
});

// `data` is a plain array with pagination in top-level `meta` (what the history page reads).
const getAdjustments = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await StockService.getAdjustments(paginationHelpers.calculatePagination(req, 20), {
    action: queryString(req, "action"),
    locationId: queryString(req, "business_location"),
    adjustBy: queryString(req, "adjust_by"),
    search: queryString(req, "search"),
    startDate: queryString(req, "startDate"),
    endDate: queryString(req, "endDate"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stock adjustments fetched successfully.",
    data,
    meta,
  });
});

export const StockController = {
  getAvailability,
  getStocks,
  getStockReport,
  getVariantReport,
  createAdjustment,
  getAdjustments,
};
