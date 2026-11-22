import express from "express";
import { staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { SupplierController } from "./supplier.controller";
import { SupplierValidation } from "./supplier.validation";

const router = express.Router();

router.get(
  "/",
  ...staff(["supplier.view", "purchase.create", "purchase.update", "purchase.view"]),
  SupplierController.getAll
);
router.get("/:id", ...staff(["supplier.view", "supplier.update"]), SupplierController.getById);
router.post(
  "/",
  ...staff("supplier.create"),
  validateRequest(SupplierValidation.createSchema),
  SupplierController.create
);
router.patch(
  "/:id",
  ...staff("supplier.update"),
  validateRequest(SupplierValidation.updateSchema),
  SupplierController.update
);
router.delete("/:id", ...staff("supplier.delete"), SupplierController.remove);

export const SupplierRoutes = router;
