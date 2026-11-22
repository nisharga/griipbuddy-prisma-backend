import express from "express";
import { staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { StockController } from "./stock.controller";
import { StockValidation } from "./stock.validation";

const router = express.Router();

router.get("/", ...staff(["stock.view", "stock.update", "stock.create"]), StockController.getStocks);
router.post(
  "/adjustment",
  ...staff(["stock.update", "stock.create"]),
  validateRequest(StockValidation.createAdjustmentSchema),
  StockController.createAdjustment
);
router.get("/adjustment", ...staff(["stock.view", "stock.update"]), StockController.getAdjustments);
// Before "/:productId/:variantId" so "variant" isn't read as a product id.
router.get("/variant/:variantId", ...staff(["stock.view", "stock.update"]), StockController.getVariantReport);
// Public (storefront): availability of one variant.
router.get("/:productId/:variantId", StockController.getAvailability);

export const StockRoutes = router;
