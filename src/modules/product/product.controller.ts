import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { auditLog } from "@/helpers/auditLogger";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { queryString } from "@/helpers/queryHelper";
import { ProductService } from "./product.service";
import { ProductPublicService } from "./product.public.service";

const ok = (res: Response, message: string, data?: unknown, statusCode: number = httpStatus.OK) =>
  sendResponse(res, { statusCode, success: true, message, data });
const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));

// ---------------------------------------------------------------- storefront (public)
const getPublicProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductPublicService.listPublic(paginationHelpers.calculatePagination(req, 12), {
    search: queryString(req, "search_query") ?? queryString(req, "q") ?? queryString(req, "searchTerm"),
    category: queryString(req, "category"),
    subcategory: queryString(req, "subcategory"),
    min_price: num(req.query.min_price),
    max_price: num(req.query.max_price),
    sortBy: queryString(req, "sortBy"),
    sortOrder: queryString(req, "sortOrder") === "asc" ? "asc" : "desc",
    top_selling: queryString(req, "top_selling") === "true",
  });
  ok(res, "Products fetched successfully.", result);
});

// Storefront home infinite scroll: `data.products` + top-level `meta.total_pages`.
const getRandomProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductPublicService.listRandom(paginationHelpers.calculatePagination(req, 20));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Products fetched successfully.",
    data: result,
    meta: result.meta,
  });
});

const getPublicProductsByIds = catchAsync(async (req: Request, res: Response) => {
  const ids = (queryString(req, "ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  ok(res, "Products fetched successfully.", await ProductPublicService.getPublicByIds(ids));
});

const getPublicProductBySlug = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Product fetched successfully.", await ProductPublicService.getPublicBySlug(req.params.slug));
});

const getVariantsOfProduct = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Variants fetched successfully.", await ProductService.variantsOfProduct(req.params.productId));
});

// ---------------------------------------------------------------- admin
const getAdminProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductService.listAdmin(paginationHelpers.calculatePagination(req), {
    searchQuery: queryString(req, "searchQuery"),
    sku: queryString(req, "sku"),
    categoryId: queryString(req, "categoryId"),
    subcategoryId: queryString(req, "subcategoryId"),
  });
  ok(res, "Products fetched successfully.", result);
});

const searchVariants = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductService.searchVariants(paginationHelpers.calculatePagination(req, 20), {
    searchQuery: queryString(req, "searchQuery") ?? queryString(req, "search"),
    barcode: queryString(req, "barcode"),
    product_id: queryString(req, "product_id"),
  });
  ok(res, "Variants fetched successfully.", result);
});

const getProductById = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Product fetched successfully.", await ProductService.getById(req.params.id));
});

const createProduct = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductService.create(req.body);
  auditLog(req, "product.create", "product", result.id);
  ok(res, "Product created successfully.", result, httpStatus.CREATED);
});

const updateProduct = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductService.update(req.params.id, req.body);
  auditLog(req, "product.update", "product", req.params.id);
  ok(res, "Product updated successfully.", result);
});

const publishProduct = catchAsync(async (req: Request, res: Response) => {
  const published = req.body.is_published as boolean;
  const result = await ProductService.update(req.params.id, { is_published: published });
  auditLog(req, published ? "product.publish" : "product.unpublish", "product", req.params.id);
  ok(res, published ? "Product published." : "Product unpublished.", result);
});

const updateVariants = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductService.updateVariants(req.params.productId, req.body);
  auditLog(req, "product.variants_update", "product", req.params.productId);
  ok(res, "Variants updated successfully.", result);
});

const deleteVariants = catchAsync(async (req: Request, res: Response) => {
  const result = await ProductService.deleteVariants(req.params.productId, req.body?.variant_ids);
  auditLog(req, "product.variants_delete", "product", req.params.productId, {
    variant_ids: req.body?.variant_ids,
  });
  ok(res, "Variant(s) deleted successfully.", result);
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
  await ProductService.remove(req.params.id);
  auditLog(req, "product.delete", "product", req.params.id);
  ok(res, "Product deleted successfully.");
});

export const ProductController = {
  getPublicProducts,
  getRandomProducts,
  getPublicProductsByIds,
  getPublicProductBySlug,
  getVariantsOfProduct,
  getAdminProducts,
  searchVariants,
  getProductById,
  createProduct,
  updateProduct,
  publishProduct,
  updateVariants,
  deleteVariants,
  deleteProduct,
};
