import express from "express";
import { staff } from "@/middlewares/auth";
import validateRequest from "@/middlewares/validateRequest";
import { CategoryController } from "./category.controller";
import { CategoryValidation } from "./category.validation";

const router = express.Router();

// Reads are public (storefront navbar).
router.get("/", CategoryController.getAll);
router.get("/published/all", CategoryController.getPublished);
router.get("/:idOrSlug", CategoryController.getOne);
router.post(
  "/",
  ...staff("product.create"),
  validateRequest(CategoryValidation.createSchema),
  CategoryController.create
);
router.patch(
  "/:id",
  ...staff("product.update"),
  validateRequest(CategoryValidation.updateSchema),
  CategoryController.update
);
router.delete("/:id", ...staff("product.delete"), CategoryController.remove);

export const CategoryRoutes = router;
