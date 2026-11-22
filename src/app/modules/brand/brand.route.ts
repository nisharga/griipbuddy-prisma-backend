import express from "express";
import { auth, staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { BrandController } from "./brand.controller";
import { BrandValidation } from "./brand.validation";

const router = express.Router();

router.get("/all", auth, BrandController.getActive);
router.get("/admin/all", auth, BrandController.getAll);
router.get("/:id", auth, BrandController.getById);
router.post(
  "/",
  ...staff("product.create"),
  validateRequest(BrandValidation.createSchema),
  BrandController.create
);
router.patch(
  "/:id",
  ...staff("product.update"),
  validateRequest(BrandValidation.updateSchema),
  BrandController.update
);
router.delete("/:id", ...staff("product.delete"), BrandController.remove);

export const BrandRoutes = router;
