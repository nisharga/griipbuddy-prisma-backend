import express from "express";
import { auth, staff } from "@/middlewares/auth";
import validateRequest from "@/middlewares/validateRequest";
import { StockController } from "@/modules/stock/stock.controller";
import { BusinessLocationController } from "./businessLocation.controller";
import { BusinessLocationValidation } from "./businessLocation.validation";

const router = express.Router();

// Check Outlet Stocks report (both paths return the same rows + summary).
const stockReport = [...staff(["stock.view", "stock.update", "report.view"]), StockController.getStockReport];
router.get("/stock/all", ...stockReport);
router.get("/stock/category/subcategory", ...stockReport);

router.get("/", auth, BusinessLocationController.getAll);
router.get("/:id", auth, BusinessLocationController.getById);
router.post(
  "/",
  ...staff("business_locations.create"),
  validateRequest(BusinessLocationValidation.createSchema),
  BusinessLocationController.create
);
router.put(
  "/:id",
  ...staff("business_locations.update"),
  validateRequest(BusinessLocationValidation.updateSchema),
  BusinessLocationController.update
);
router.delete("/:id", ...staff("business_locations.delete"), BusinessLocationController.remove);

export const BusinessLocationRoutes = router;
