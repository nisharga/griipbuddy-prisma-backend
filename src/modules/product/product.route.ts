import express from "express";
import { auth, staff } from "@/middlewares/auth";
import validateRequest from "@/middlewares/validateRequest";
import { ProductController } from "./product.controller";
import { ProductValidation } from "./product.validation";

const router = express.Router();

// ---------------------------------------------------------------- storefront (public)
router.get("/", ProductController.getPublicProducts);
router.get("/ids", ProductController.getPublicProductsByIds);
router.get("/slug/:slug", ProductController.getPublicProductBySlug);
router.get("/variant/:productId", ProductController.getVariantsOfProduct);

// ---------------------------------------------------------------- admin
router.get("/admin/all", auth, ProductController.getAdminProducts);
router.get("/admin/variants", auth, ProductController.searchVariants);
// Download Barcode page (same list, reads `?search=`).
router.get("/variants/all", auth, ProductController.searchVariants);
router.get("/admin/products/:id", auth, ProductController.getProductById);
router.patch(
  "/admin/publish/:id",
  ...staff("product.update"),
  validateRequest(ProductValidation.publishSchema),
  ProductController.publishProduct
);
router.patch(
  "/variant/:productId",
  ...staff("product.update"),
  validateRequest(ProductValidation.updateVariantsSchema),
  ProductController.updateVariants
);
router.delete("/variant/by-product/:productId", ...staff("product.delete"), ProductController.deleteVariants);
router.post(
  "/",
  ...staff("product.create"),
  validateRequest(ProductValidation.createSchema),
  ProductController.createProduct
);
router.get("/:id", auth, ProductController.getProductById);
router.patch(
  "/:id",
  ...staff("product.update"),
  validateRequest(ProductValidation.updateSchema),
  ProductController.updateProduct
);
router.delete("/:id", ...staff("product.delete"), ProductController.deleteProduct);

export const ProductRoutes = router;
