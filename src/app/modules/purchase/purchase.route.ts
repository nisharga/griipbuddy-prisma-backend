import express from "express";
import { staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { PurchaseController } from "./purchase.controller";
import { PurchaseValidation } from "./purchase.validation";

const router = express.Router();

router.get("/", ...staff(["purchase.view", "purchase.update"]), PurchaseController.getAll);
router.post(
  "/",
  ...staff("purchase.create"),
  validateRequest(PurchaseValidation.createSchema),
  PurchaseController.create
);
router.get("/:id", ...staff(["purchase.view", "purchase.update"]), PurchaseController.getById);
router.put(
  "/:id",
  ...staff("purchase.update"),
  validateRequest(PurchaseValidation.updateSchema),
  PurchaseController.update
);

export const PurchaseRoutes = router;
