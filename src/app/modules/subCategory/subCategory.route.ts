import express from "express";
import { staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { SubCategoryController } from "./subCategory.controller";
import { SubCategoryValidation } from "./subCategory.validation";

const router = express.Router();

// Reads are public. Specific paths come before "/:idOrSlug".
router.get("/", SubCategoryController.getAll);
router.get("/by-category/:categoryId", SubCategoryController.getByCategoryId);
router.get("/by-category-slug/:slug", SubCategoryController.getByCategorySlug);
router.get("/sub-subcategory/by-subcategory-id/:id", SubCategoryController.getChildrenById);
router.get("/sub-subcategory/by-subcategory-slug/:slug", SubCategoryController.getChildrenBySlug);
router.post(
  "/sub-subcategory/create",
  ...staff("product.create"),
  validateRequest(SubCategoryValidation.createChildSchema),
  SubCategoryController.createChild
);
router.delete("/sub-subcategory/:id", ...staff("product.delete"), SubCategoryController.removeChild);
router.post(
  "/",
  ...staff("product.create"),
  validateRequest(SubCategoryValidation.createSchema),
  SubCategoryController.create
);
router.get("/:idOrSlug", SubCategoryController.getOne);
router.patch(
  "/:id",
  ...staff("product.update"),
  validateRequest(SubCategoryValidation.updateSchema),
  SubCategoryController.update
);
router.delete("/:id", ...staff("product.delete"), SubCategoryController.remove);

export const SubCategoryRoutes = router;
